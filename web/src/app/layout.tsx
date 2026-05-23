export const metadata = { title: "你画我猜", description: "Draw & Guess — Multiplayer Party Game" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f0f2f5", fontFamily: 'system-ui, "PingFang SC", sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
