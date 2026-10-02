import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
export default function ({
  db,
  router,
  run,
  get,
  all,
  id,
  now,
  text,
  required,
  fail,
}) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),title TEXT,status TEXT,error TEXT,created_at TEXT);`,
  );
  const root = resolve(process.env.VIDEO_DIR || "data/videos");
  mkdirSync(root, { recursive: true });
  let busy = false;
  const queue = [];
  run(
    "UPDATE videos SET status='error',error='Sunucu yeniden başladı; yeniden yükleyin' WHERE status IN ('queued','processing')",
  );
  function processQueue() {
    if (busy || !queue.length) return;
    busy = true;
    const vid = queue.shift(),
      dir = join(root, vid);
    run("UPDATE videos SET status='processing' WHERE id=?", vid);
    let output = "";
    const ff = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        join(dir, "input.mp4"),
        "-t",
        "30",
        "-vf",
        "scale=640:-2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_list_size",
        "0",
        join(dir, "index.m3u8"),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let finished = false;
    const finish = (ok, reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      run(
        "UPDATE videos SET status=?,error=? WHERE id=?",
        ok ? "ready" : "error",
        ok ? "" : reason.slice(-1000),
        vid,
      );
      busy = false;
      processQueue();
    };
    const timer = setTimeout(() => {
      ff.kill("SIGKILL");
      finish(false, "60 saniye işlem sınırı");
    }, 60000);
    ff.stderr.on("data", (b) => {
      output = (output + b.toString()).slice(-3000);
    });
    ff.on("error", (e) => finish(false, e.message));
    ff.on("close", (code) => finish(code === 0, output));
  }
  router.get("/videos", (req, res) =>
    res.json(
      all(
        "SELECT * FROM videos WHERE owner=? ORDER BY created_at DESC",
        req.user.id,
      ),
    ),
  );
  router.post("/videos", (req, res) => {
    if (queue.length > 3) fail(429, "Video kuyruğu dolu");
    const title = text(req.body.title);
    const buf = Buffer.from(text(req.body.base64, 11000000), "base64");
    if (
      buf.length > 8 * 1024 * 1024 ||
      buf.length < 12 ||
      buf.toString("ascii", 4, 8) !== "ftyp"
    )
      fail(422, "En fazla 8 MB MP4 gerekli");
    const vid = id(),
      dir = join(root, vid);
    mkdirSync(dir);
    writeFileSync(join(dir, "input.mp4"), buf);
    run(
      "INSERT INTO videos VALUES(?,?,?,?,?,?)",
      vid,
      req.user.id,
      title,
      "queued",
      "",
      now(),
    );
    queue.push(vid);
    processQueue();
    res.status(202).json({ id: vid });
  });
  router.get("/videos/:id/file/:name", (req, res) => {
    const v = required(
      get(
        "SELECT * FROM videos WHERE id=? AND owner=?",
        req.params.id,
        req.user.id,
      ),
    );
    if (!/^(index\.m3u8|index\d+\.ts|input\.mp4)$/.test(req.params.name))
      fail(404, "Dosya bulunamadı");
    const file = join(root, v.id, req.params.name);
    if (!existsSync(file)) fail(404, "Video henüz hazır değil");
    res.sendFile(file);
  });
}
