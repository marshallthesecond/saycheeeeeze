// lib/pfps.ts — server-only. Reads public/pfps at build time.
// import fs from "node:fs";
// import path from "node:path";

// const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

// export function getPfps(): string[] {
//   const dir = path.join(process.cwd(), "public", "pfps");

//   let files: string[] = [];
//   try {
//     files = fs.readdirSync(dir);
//   } catch {
//     return [];
//   }

//   return files
//     .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
//     // "2.jpg" sorts before "10.jpg" thanks to numeric collation
//     .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
//     .map((f) => `/pfps/${f}`);
// }

export const pfps = [
  "/pfps/7.jpg",
  "/pfps/13.jpg",
  "/pfps/14.jpg",
  "/pfps/15.jpg",
  "/pfps/16.jpg",
];