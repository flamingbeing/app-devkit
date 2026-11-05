// Spacing audit for any screen (import from .devkit/playwright/gaps.mjs; lifted from an app's own e2e): finds painted blocks (cards, lists, fields, buttons, banners) that overlap or sit
// closer than MIN px to a neighbour. Two blocks are compared only when they share the same nearest painted ancestor
// (rows inside one card are that card's business, not the page's). Call it per screen from the app's e2e, in every look.
export const MIN = 8;

/** @param {import("playwright").Page} page @returns {Promise<string[]>} one line per problem */
export async function gaps(page, scope = ".ui-screen:not([hidden]):not([inert])") {
  return page.evaluate(([scope, MIN]) => {
    const painted = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      const bg = cs.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
      const fill = bg.length && (bg.length < 4 || bg[3] > 0.02);
      const edge = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs["border" + s + "Width"]) > 0 && !/rgba\(.*, 0\)$/.test(cs["border" + s + "Color"]));
      return fill || edge || cs.backgroundImage !== "none";
    };
    const roots = [...document.querySelectorAll(scope)].filter((r) => r.getClientRects().length && r.getBoundingClientRect().width > 0);
    const out = [];
    for (const root of roots) {
      const view = root.getBoundingClientRect();
      const boxes = [];
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("[hidden],[aria-hidden='true'],.ui-bar,.ui-tabbar,svg,.ico,table") || !painted(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < view.top || r.top > view.bottom + 4000) continue;
        if (getComputedStyle(el).position === "fixed" || getComputedStyle(el).position === "sticky") continue;
        let up = el.parentElement;
        while (up && up !== root && !painted(up)) up = up.parentElement;
        boxes.push({ el, r, up });
      }
      const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")
        + ` "${(el.textContent || el.placeholder || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 24)}"`;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.up !== b.up || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const xo = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const yo = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        // rows of one list or segments of one bar: siblings of one kind laid edge to edge on purpose
        const kin = a.el.tagName === b.el.tagName && a.el.className === b.el.className && (a.el.parentElement === b.el.parentElement
          || (Math.abs(a.r.left - b.r.left) < 1 && Math.abs(a.r.width - b.r.width) < 1));
        if (kin && ((xo > 1 && Math.abs(yo) <= 1.5) || (yo > 1 && Math.abs(xo) <= 1.5))) continue;
        if (xo > 1 && yo > 1) out.push(`overlap ${Math.round(xo)}x${Math.round(yo)}: ${name(a.el)} / ${name(b.el)}`);
        else if (xo > 1 && yo > -MIN) out.push(`${Math.round(-yo)}px apart (over/under): ${name(a.el)} / ${name(b.el)}`);
        else if (yo > 1 && xo > -MIN + 2 && xo <= 1) out.push(`${Math.round(-xo)}px apart (side by side): ${name(a.el)} / ${name(b.el)}`);
      }
    }
    return out;
  }, [scope, MIN]);
}

/**
 * The audit on one screen in every look of the app, as [name, ok, detail] checks for the app's own test reporter.
 * @param {import("playwright").Page} page
 * @param {string} label  the screen's name in the check
 * @param {{ scope?: string, looks?: { name: string, set: (page: import("playwright").Page) => Promise<unknown>, reset?: (page: import("playwright").Page) => Promise<unknown> }[] }} [o]
 *   looks: one entry per look; `set` switches to it, `reset` (optional) puts the page back after. No looks: the page as it is.
 */
export async function spacing(page, label, { scope, looks = [{ name: "", set: async () => {} }] } = {}) {
  const out = [];
  for (const look of looks) {
    await look.set(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const g = [...new Set(await gaps(page, scope))];
    out.push([`${label}: no blocks overlapping or closer than ${MIN}px${look.name ? ` (${look.name})` : ""}`, !g.length, g.slice(0, 6).join(" | ")]);
    await look.reset?.(page);
  }
  return out;
}
