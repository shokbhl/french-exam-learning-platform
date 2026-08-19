import{test,expect}from"@playwright/test";

// These cover the offline demonstration mode, where no session is required.
// Once Supabase is configured every route is gated behind sign-in, so the
// members-only path is covered by member-access.spec.ts instead.
test.skip(
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  "covered by member-access.spec.ts when Supabase is configured",
);

test("dashboard reaches original listening practice",async({page})=>{await page.goto("/");await expect(page.getByRole("heading",{name:/Bonjour/})).toBeVisible();await page.getByRole("link",{name:"Écouter & lire"}).click();await expect(page.getByRole("heading",{name:"Un changement de rendez-vous"})).toBeVisible();await page.getByRole("button",{name:/Pour changer/}).click();await page.getByRole("button",{name:"Valider"}).click();await expect(page.getByText("Bonne réponse")).toBeVisible()});
test("onboarding keeps exam date optional",async({page})=>{await page.goto("/onboarding");await expect(page.getByRole("heading",{name:/programme qui s’adapte/})).toBeVisible();expect(await page.getByLabel("Date d’examen (facultative)").getAttribute("required")).toBeNull()});
test("admin materials explains unconfigured storage",async({page})=>{await page.goto("/admin/materials");await page.getByRole("button",{name:"Importer"}).click();await expect(page.getByText(/publication jamais automatique/)).toBeVisible()});
