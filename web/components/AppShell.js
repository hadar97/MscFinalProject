import Header from "./Header";

// Layout for signed-in pages: the top bar + a centered content column
export default function AppShell({ children, width = "max-w-[1200px]" }) {
  return (
    <div className="min-h-full">
      <Header />
      <main className={`mx-auto w-full ${width} px-6 pb-20 pt-10 md:px-10`}>{children}</main>
    </div>
  );
}
