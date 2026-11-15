// Turning a title into an address, and the two rules an address and a
// category must pass.
//
// Imported by the New gallery form (to show the address while the title is
// typed) and by the server action, so the browser and the server always
// agree. The database checks the same two rules again in
// studio_create_gallery(); these exist so the form can say what is wrong
// before anything is sent.

// Russian and Uzbek Cyrillic, the same table scripts/reseed.ts uses, so a
// gallery named in the Studio and a folder named in Bunny come out alike.
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

export const SLUG_MAX = 60;

/** "Sara, выпускной 2026" -> "sara-vypusknoy-2026". May return "". */
export function slugify(text: string): string {
  const latin = [...text.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  return (
    latin
      // o'zbek -> ozbek, not o-zbek.
      .replace(/['’ʻʼ`]/g, "")
      // é -> e
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/, "")
  );
}

/** Lowercase letters and digits in runs joined by single hyphens, 2 to 60. */
export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= SLUG_MAX && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/** Folders the storage zone keeps for itself. A category is a top-level folder. */
const RESERVED_CATEGORIES = ["d", "clients", "u"];

export type CategoryProblem = "format" | "reserved";

/**
 * A category becomes a folder name and a filter chip on the Portfolio page:
 * Latin letters, digits, spaces, hyphens and underscores, 2 to 40 characters,
 * starting and ending with a letter or digit.
 */
export function categoryProblem(category: string): CategoryProblem | null {
  const c = category.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,38}[A-Za-z0-9]$/.test(c)) return "format";
  if (RESERVED_CATEGORIES.includes(c.toLowerCase())) return "reserved";
  return null;
}
