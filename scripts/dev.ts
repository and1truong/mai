// Chạy dev: watch build frontend + hot reload server, trong một lệnh.

const procs = [
  Bun.spawn(
    ["bun", "build", "./src/client/index.html", "--outdir", "./dist/client", "--watch"],
    { stdout: "inherit", stderr: "inherit" },
  ),
  Bun.spawn(["bun", "--hot", "src/server/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    // MAI_HOT=1 → server tự dọn runner/db/port của lần chạy trước khi reload.
    env: { ...Bun.env, MAI_HOT: "1" },
  }),
];

const dung = () => {
  for (const p of procs) p.kill();
};

process.on("SIGINT", () => {
  dung();
  process.exit(0);
});
process.on("SIGTERM", dung);

await Promise.all(procs.map((p) => p.exited));

export {};
