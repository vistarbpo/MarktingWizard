#!/usr/bin/env node
// Restore a Marketing Wizard backup into a folder (never over a live DATA_DIR unless you pass --force).
//   BACKUP_KEY=<key> node web/scripts/restore-backup.js <backup-file> <out-dir> [--force]
// Checks every checksum in the manifest, then writes db.json, crm.json and media/ into <out-dir>.
// Then: stop the app in hPanel, move the current files in DATA_DIR aside, upload these, start the app.
import fs from "node:fs";
import path from "node:path";
import { countsOf, openBackup } from "../lib/backup.js";

const [file, out, flag] = process.argv.slice(2);
if (!file || !out) { console.error("Usage: BACKUP_KEY=<key> node web/scripts/restore-backup.js <backup-file> <out-dir> [--force]"); process.exit(2); }
if (fs.existsSync(path.join(out, "db.json")) && flag !== "--force") { console.error(`${out} already has a db.json. Pick an empty folder, or pass --force to overwrite.`); process.exit(2); }
try {
  const { manifest, db, crm, files } = await openBackup(fs.readFileSync(file), process.env.BACKUP_KEY || "");
  fs.mkdirSync(path.join(out, "media"), { recursive: true });
  for (const f of files) {
    if (f.name === "manifest.json") continue;
    if (!/^(db\.json|crm\.json|media\/[A-Za-z0-9._-]+)$/.test(f.name)) { console.warn("Skipping unexpected entry", f.name); continue; }
    fs.writeFileSync(path.join(out, f.name), f.data);
  }
  console.log(`Restored backup from ${manifest.created_at} (${manifest.kind}) into ${out}`);
  console.log("db.json:", JSON.stringify(countsOf(db)));
  console.log("crm.json:", JSON.stringify(countsOf(crm)));
  console.log(`media files: ${manifest.media_included}${manifest.media_note ? " (" + manifest.media_note + ")" : ""}`);
} catch (e) {
  console.error("Restore failed:", e.message);
  process.exit(1);
}
