/**
 * ALS - matrix factorization for implicit feedback (Hu, Koren & Volinsky 2008),
 * the CF model named in the project proposal. Shared by:
 *   CF/train-als.js           - trains on all ratings, saves the book vectors
 *   HYBRID/hybrid-recommender - computes a user's vector at request time
 *
 * Model: every rating = "the user read the book" (preference 1), with
 * confidence c = 1 + alpha * rating / 5. Learns f numbers per user (x_u) and
 * per book (y_i) so that x_u . y_i is close to 1 for books the user read
 * (weighted by c) and close to 0 for the rest.   score(u, i) = x_u . y_i
 *
 * The same algorithm (same settings) as the ALS models in evaluate.js, where
 * it was measured and chosen: f = 128, alpha = 10, lambda = 0.1, 10 iterations.
 */

const DEFAULTS = { factors: 128, alpha: 10, reg: 0.1, iters: 10, cgSteps: 3, seed: 42 };

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Rows grouped by `group` (users or books): start[g]..start[g+1] in other/value
function buildCSR(groupIdx, otherIdx, vals, nGroups) {
  const start = new Int32Array(nGroups + 1);
  for (const g of groupIdx) start[g + 1]++;
  for (let g = 0; g < nGroups; g++) start[g + 1] += start[g];
  const pos = start.slice(0, nGroups);
  const other = new Int32Array(groupIdx.length);
  const value = new Float32Array(groupIdx.length);
  for (let k = 0; k < groupIdx.length; k++) {
    const p = pos[groupIdx[k]]++;
    other[p] = otherIdx[k];
    value[p] = vals[k];
  }
  return { start, other, value };
}

/** F^T F (f x f, full symmetric) */
function gram(F, n, f) {
  const G = new Float64Array(f * f);
  for (let j = 0; j < n; j++) {
    const o = j * f;
    for (let a = 0; a < f; a++) {
      const fa = F[o + a];
      if (fa === 0) continue;
      for (let b = a; b < f; b++) G[a * f + b] += fa * F[o + b];
    }
  }
  for (let a = 0; a < f; a++) for (let b = 0; b < a; b++) G[a * f + b] = G[b * f + a];
  return G;
}

/**
 * Train on (user index, book index, rating) arrays.
 * @returns {{X: Float64Array, Y: Float64Array, f: number}}  X = nU x f, Y = nB x f
 */
function trainALS(uIdx, bIdx, ratings, nU, nB, opts = {}) {
  const { factors: f, alpha, reg, iters, cgSteps, seed } = { ...DEFAULTS, ...opts };
  const rand = seededRandom(seed);
  const conf = Float32Array.from(ratings, (r) => 1 + (alpha * r) / 5);
  const byUser = buildCSR(uIdx, bIdx, conf, nU);
  const byItem = buildCSR(bIdx, uIdx, conf, nB);
  const X = new Float64Array(nU * f);
  const Y = new Float64Array(nB * f);
  for (let k = 0; k < X.length; k++) X[k] = (rand() - 0.5) * 0.01;
  for (let k = 0; k < Y.length; k++) Y[k] = (rand() - 0.5) * 0.01;
  const r = new Float64Array(f), pv = new Float64Array(f), Ap = new Float64Array(f), x = new Float64Array(f);
  let G;

  // A v = G v + lambda v + sum_i (c_i - 1)(y_i . v) y_i
  const mulA = (v, out, F, csr, start, end) => {
    for (let a = 0; a < f; a++) {
      let s = reg * v[a];
      const ga = a * f;
      for (let b = 0; b < f; b++) s += G[ga + b] * v[b];
      out[a] = s;
    }
    for (let q = start; q < end; q++) {
      const o = csr.other[q] * f;
      let dot = 0;
      for (let a = 0; a < f; a++) dot += F[o + a] * v[a];
      const w = (csr.value[q] - 1) * dot;
      for (let a = 0; a < f; a++) out[a] += w * F[o + a];
    }
  };

  // Solve every row of T given the fixed factors F (conjugate gradient, warm start)
  const solveSide = (T, nT, csr, F, nF) => {
    G = gram(F, nF, f);
    for (let t = 0; t < nT; t++) {
      const start = csr.start[t], end = csr.start[t + 1];
      const ot = t * f;
      if (start === end) { for (let a = 0; a < f; a++) T[ot + a] = 0; continue; }
      for (let a = 0; a < f; a++) x[a] = T[ot + a];
      mulA(x, Ap, F, csr, start, end);
      for (let a = 0; a < f; a++) r[a] = -Ap[a];
      for (let q = start; q < end; q++) {
        const o = csr.other[q] * f, c = csr.value[q];
        for (let a = 0; a < f; a++) r[a] += c * F[o + a];
      }
      let rs = 0;
      for (let a = 0; a < f; a++) { pv[a] = r[a]; rs += r[a] * r[a]; }
      for (let step = 0; step < cgSteps && rs > 1e-10; step++) {
        mulA(pv, Ap, F, csr, start, end);
        let pAp = 0;
        for (let a = 0; a < f; a++) pAp += pv[a] * Ap[a];
        const al = rs / pAp;
        let rsNew = 0;
        for (let a = 0; a < f; a++) {
          x[a] += al * pv[a];
          r[a] -= al * Ap[a];
          rsNew += r[a] * r[a];
        }
        for (let a = 0; a < f; a++) pv[a] = r[a] + (rsNew / rs) * pv[a];
        rs = rsNew;
      }
      for (let a = 0; a < f; a++) T[ot + a] = x[a];
    }
  };

  for (let it = 0; it < iters; it++) {
    const t0 = Date.now();
    solveSide(X, nU, byUser, Y, nB);
    solveSide(Y, nB, byItem, X, nU);
    if (opts.onIteration) opts.onIteration(it + 1, Date.now() - t0);
  }
  return { X, Y, f };
}

/**
 * The vector of a user who is NOT in the training data (a new app user):
 * one exact solve of  (Y^T Y + sum (c_i - 1) y_i y_i^T + lambda I) x = sum c_i y_i
 * over the books he rated that have a vector.
 * @param {Float64Array} YtY   f x f, saved by train-als.js
 * @param {{vector: number[], rating: number}[]} rated
 */
function foldInUser(YtY, rated, f, alpha, reg) {
  const A = Float64Array.from(YtY);
  const b = new Float64Array(f);
  for (const { vector: y, rating } of rated) {
    const c = 1 + (alpha * rating) / 5;
    for (let a = 0; a < f; a++) {
      b[a] += c * y[a];
      const wa = (c - 1) * y[a];
      for (let k = 0; k < f; k++) A[a * f + k] += wa * y[k];
    }
  }
  for (let a = 0; a < f; a++) A[a * f + a] += reg;
  // Cholesky A = L L^T, then two triangular solves
  const L = new Float64Array(f * f);
  for (let i = 0; i < f; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * f + j];
      for (let k = 0; k < j; k++) s -= L[i * f + k] * L[j * f + k];
      L[i * f + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * f + j];
    }
  }
  const z = new Float64Array(f), x = new Float64Array(f);
  for (let i = 0; i < f; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * f + k] * z[k];
    z[i] = s / L[i * f + i];
  }
  for (let i = f - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < f; k++) s -= L[k * f + i] * x[k];
    x[i] = s / L[i * f + i];
  }
  return x;
}

const toVectorLiteral = (arr) => "[" + Array.from(arr, (v) => Number(v).toPrecision(7)).join(",") + "]";

module.exports = { DEFAULTS, trainALS, foldInUser, gram, toVectorLiteral };
