/**
 * Merge duplicate books in the `books` table.
 *
 * A row is treated as a duplicate of another when:
 *   1. it has the same title + same first author (case-insensitive), AND
 *   2. its embedding is similar enough to the kept row's embedding
 *      (cosine similarity >= threshold). This protects against merging two
 *      genuinely different books that happen to share a title, like "Poems".
 *      Rows missing an embedding can't be compared, so they are merged on
 *      title + author alone.
 *
 * Which copy is KEPT in each group (in this priority order):
 *   1. language = 'en'
 *   2. has an embedding
 *   3. has a non-empty description (an empty one is embedded from the title
 *      only, which can look "central" without carrying any real content)
 *   4. the most "representative" copy: highest average similarity to the other
 *      copies of the same book. A broken description (e.g. wrong text from
 *      Google, a different language) is an outlier, so it loses.
 *      Note: in a group of only 2 copies the average is identical for both, so
 *      this step cannot separate them and the next rule decides.
 *   5. longest description
 *   6. lowest id
 *
 * The kept row gets `search_terms` and `categories` merged from all copies,
 * and the other copies are deleted.
 *
 * Usage:
 *   node merge-duplicates.js                      -> DRY RUN (changes nothing)
 *   node merge-duplicates.js --apply              -> actually applies changes
 *   node merge-duplicates.js --threshold=0.3      -> change similarity threshold (default 0.2)
 */

const { Pool } = require("pg");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");

const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.2;
if (Number.isNaN(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1) {
  console.error("Invalid --threshold value, use a number between 0 and 1");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function formatAuthors(authors) {
  return authors && authors.length ? authors.join(", ") : "Unknown author";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const before = await client.query("SELECT count(*)::int AS n FROM books;");
    console.log("Rows before: " + before.rows[0].n);
    console.log("Similarity threshold: " + THRESHOLD + "\n");

    // 1. New array column for search terms (old search_term column stays untouched)
    await client.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS search_terms text[];");
    await client.query(`
      UPDATE books
      SET search_terms = ARRAY[search_term]
      WHERE search_terms IS NULL AND search_term IS NOT NULL;
    `);

    // 2. Candidates: same title + first author, with similarity to the row we keep.
    //    The kept row is the most representative copy (see header comment).
    await client.query(`
      CREATE TEMP TABLE candidates AS
      WITH keyed AS (
        SELECT
          id,
          embedding,
          description,
          language,
          lower(trim(title)) AS t,
          coalesce(lower(trim(authors[1])), '') AS a
        FROM books
      ),
      scores AS (
        -- average similarity of each row to the other copies of the same book
        SELECT
          x.id,
          avg(1 - (x.embedding <=> y.embedding)) AS avg_sim
        FROM keyed x
        JOIN keyed y ON x.t = y.t AND x.a = y.a AND x.id != y.id
        WHERE x.embedding IS NOT NULL AND y.embedding IS NOT NULL
        GROUP BY x.id
      ),
      ranked AS (
        SELECT
          k.id,
          first_value(k.id) OVER (
            PARTITION BY k.t, k.a
            ORDER BY coalesce(k.language = 'en', false) DESC,
                     (k.embedding IS NOT NULL) DESC,
                     (length(trim(coalesce(k.description, ''))) > 0) DESC,
                     coalesce(s.avg_sim, -1) DESC,
                     length(coalesce(k.description, '')) DESC,
                     k.id
          ) AS keep_id
        FROM keyed k
        LEFT JOIN scores s ON s.id = k.id
      )
      SELECT
        r.id,
        r.keep_id,
        CASE
          WHEN d.embedding IS NULL OR kp.embedding IS NULL THEN NULL
          ELSE 1 - (d.embedding <=> kp.embedding)
        END AS sim
      FROM ranked r
      JOIN books d ON d.id = r.id
      JOIN books kp ON kp.id = r.keep_id
      WHERE r.id != r.keep_id;
    `);

    // 3. Split: merge (similar enough or not comparable) vs skipped (too different)
    await client.query(`
      CREATE TEMP TABLE dup_map AS
      SELECT id, keep_id, sim FROM candidates
      WHERE sim IS NULL OR sim >= ${THRESHOLD};
    `);

    const toDelete = await client.query("SELECT count(*)::int AS n FROM dup_map;");
    const skipped = await client.query(`
      SELECT c.id, c.keep_id, c.sim, b.title, b.authors
      FROM candidates c
      JOIN books b ON b.id = c.id
      WHERE c.sim IS NOT NULL AND c.sim < ${THRESHOLD}
      ORDER BY c.sim DESC;
    `);
    const noEmbedding = await client.query(
      "SELECT count(*)::int AS n FROM dup_map WHERE sim IS NULL;"
    );

    console.log("Duplicate rows to merge and delete: " + toDelete.rows[0].n);
    console.log("  (of which without embedding, merged on title + author only: " + noEmbedding.rows[0].n + ")");
    console.log("Same title + author but TOO DIFFERENT to merge (kept separate): " + skipped.rows.length);

    if (skipped.rows.length > 0) {
      console.log("\nKept separate (title, author, similarity to the kept copy):");
      skipped.rows.slice(0, 15).forEach((r) => {
        console.log(
          "  id=" + r.id + " \"" + r.title + "\" - " + formatAuthors(r.authors) +
          " (similarity: " + Number(r.sim).toFixed(3) + ")"
        );
      });
      if (skipped.rows.length > 15) {
        console.log("  ... and " + (skipped.rows.length - 15) + " more");
      }
      console.log("  Tip: if these look like the same book, lower --threshold and run again.");
    }

    // Show most duplicated books so you can sanity check which copy survives
    const examples = await client.query(`
      SELECT k.id AS keep_id, k.title, k.authors, count(*)::int + 1 AS copies,
             round(min(d.sim)::numeric, 3) AS min_sim,
             left(coalesce(k.description, ''), 70) AS kept_description
      FROM dup_map d
      JOIN books k ON k.id = d.keep_id
      GROUP BY k.id, k.title, k.authors, k.description
      ORDER BY copies DESC
      LIMIT 10;
    `);
    console.log("\nTop duplicated books being merged (id of the copy that is kept):");
    examples.rows.forEach((r) => {
      console.log(
        "  " + r.copies + " copies - \"" + r.title + "\" - " + formatAuthors(r.authors) +
        (r.min_sim !== null ? " (lowest similarity: " + r.min_sim + ")" : "") +
        "\n      kept id=" + r.keep_id + ": " + (r.kept_description || "(no description)")
      );
    });

    // 4. Merge search terms into the kept row
    await client.query(`
      UPDATE books k
      SET search_terms = (
        SELECT array_agg(DISTINCT t)
        FROM books b, unnest(b.search_terms) AS t
        WHERE b.id = k.id
           OR b.id IN (SELECT id FROM dup_map WHERE keep_id = k.id)
      )
      WHERE k.id IN (SELECT keep_id FROM dup_map);
    `);

    // 5. Merge categories into the kept row (keeps existing value if nothing to merge)
    await client.query(`
      UPDATE books k
      SET categories = coalesce((
        SELECT array_agg(DISTINCT c)
        FROM books b, unnest(b.categories) AS c
        WHERE b.id = k.id
           OR b.id IN (SELECT id FROM dup_map WHERE keep_id = k.id)
      ), k.categories)
      WHERE k.id IN (SELECT keep_id FROM dup_map);
    `);

    // 6. Delete the duplicates
    await client.query("DELETE FROM books WHERE id IN (SELECT id FROM dup_map);");

    const after = await client.query("SELECT count(*)::int AS n FROM books;");
    console.log("\nRows after: " + after.rows[0].n);

    if (APPLY) {
      await client.query("COMMIT");
      console.log("\nAPPLIED - changes saved.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN - nothing was changed. Run with --apply to save.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error - rolled back, nothing changed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();