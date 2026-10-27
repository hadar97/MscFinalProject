import "./globals.css";

export const metadata = {
  title: "BookBridge",
  description: "Book recommendations that fit your taste - and where to borrow them nearby.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Fonts are loaded by the browser (works offline at build time too) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=DM+Sans:wght@400;500;700&display=swap"
        />
      </head>
     <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
