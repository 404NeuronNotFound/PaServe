import {
  OWNER_WALKTHROUGH_PAGES,
  type OwnerWalkthroughPage,
  type ShopRole,
  canAccessWalkthroughPage,
} from "@paserve/contracts";
import type { TourStep } from "./steps";

export function ownerPageForPath(
  pathname: string,
): OwnerWalkthroughPage | undefined {
  const path = pathname.match(/^\/app\/shops\/[^/]+\/(.+?)\/?$/)?.[1];
  if (path && /^products\/[^/]+\/customize$/.test(path))
    return "product-customize";
  const page = path?.startsWith("orders/") ? "orders" : path;
  return OWNER_WALKTHROUGH_PAGES.find((candidate) => candidate === page);
}

const lessons: Record<OwnerWalkthroughPage, [string, string, string][]> = {
  products: [
    [
      "Your menu starts here",
      "Dito ang product list mo, owner! Prices, categories, photos at availability ang chine-check natin. Guide lang ito; walang products na gagawin for you.",
      "#products-title",
    ],
    [
      "First product? Dito tayo",
      "After this guide, Create product ang start. Add a clear name, tamang price at category. Optional ang photo; review muna bago i-save, okay?",
      "#create-product-button",
    ],
    [
      "Active or archived?",
      "Active ang current catalog. Archived keeps products out of the active list. Check the selected view bago maghanap o mag-restore.",
      ".product-view-switch",
    ],
    [
      "Hanapin, huwag hulaan",
      "Kapag may products na, use search at filters para makita ang tamang item. Hindi nawawala ang product dahil lang filtered ang list, ha!",
      ".product-browse-controls",
    ],
    [
      "Availability matters",
      "Check each product's price at availability before service. Sold out is for temporary unavailability; iba iyon sa pag-archive. A hidden category can still keep an available product off the menu.",
      ".product-card",
    ],
    [
      "Make every order personal",
      "Kapag may product na, open Customize for choices at add-ons. Review required choices and extra charges bago i-offer sa customer. May separate guide tayo sa page na iyon.",
      '.products-page a[href$="/customize"]',
    ],
    [
      "Check the customer's view",
      "After saving your catalog, visit Menu preview. Check category visibility, photos, prices at choices as a customer would. Walang need gumawa ng test payment.",
      '[data-walkthrough="shop-group-menu"]',
    ],
  ],
  "product-customize": [
    [
      "Choices for the right product",
      "Check the product name muna. Dito ang choices at extras for this product, so make sure tama ang item na inaayos natin.",
      "#customize-title",
    ],
    [
      "Required ba or optional?",
      "Sa choices, review the group, options at selection rules. Keep required choices clear para alam ng customer kung ano ang kailangan piliin.",
      "#customization-choices-panel",
    ],
    [
      "Extra, pero clear",
      "Sa add-ons, enable only the extras na available sa product na ito. Check each extra charge; customers should see what they are paying for.",
      "#customization-addons-panel",
    ],
    [
      "Review before service",
      "Check changes sa Menu preview after saving. Kapag may error or uncertain result, read the page message first bago mag-submit ulit.",
      "#customize-title",
    ],
  ],
  categories: [
    [
      "Give your menu some order",
      "Categories group your products. Clear names help customers find drinks, food or their usual faster.",
      "#categories-title",
    ],
    [
      "Name it clearly",
      "After the guide, add the category name here. Avoid duplicate or confusing names, then review bago mag-save.",
      "#create-category-title",
    ],
    [
      "Visible ba sa customer?",
      "Check visibility sa list. Hiding a category can keep its products off the public menu even when those products are available.",
      "#category-list-title",
    ],
    [
      "Arrange the menu",
      "Use reorder when you want to change the category order. Review the final order sa Menu preview; hindi ito automatic na sales ranking.",
      "#category-reorder-button",
    ],
  ],
  "add-ons": [
    [
      "Your shop's extras",
      "Create an extra once, then choose which products offer it. Clear names at accurate charges ang goal natin.",
      "#addons-title",
    ],
    [
      "Create an add-on",
      "After the guide, use Create add-on. Check the name, price at visibility before saving.",
      ".addon-create-fab",
    ],
    [
      "Find an existing extra",
      "May existing add-on na ba? Search muna para iwas duplicate. Check which products already use it before making changes.",
      "#addon-search",
    ],
    [
      "Connect it to a product",
      "Open a product's Customize page to enable the right extras. Hindi ibig sabihin na created na ang add-on ay offered na agad sa lahat ng products.",
      ".addon-library-panel",
    ],
  ],
  "menu-preview": [
    [
      "Borrow your customer's eyes",
      "Ito ang menu preview. Check the shop, product details, visibility at layout before sharing your menu.",
      ".live-menu-preview",
    ],
    [
      "Phone and wide screen",
      "Use the preview controls to check the available screen sizes. Make sure readable ang names, prices at choices on a smaller screen too.",
      ".menu-preview-toolbar",
    ],
    [
      "Preview, then decide",
      "Browse your menu here. If may kailangang ayusin, go back to the right catalog page. Looking around does not require a real order or payment.",
      ".menu-preview-scroll",
    ],
  ],
  sales: [
    [
      "Same period, same story",
      "Piliin muna ang reporting period. I-check ang date at timezone before comparing sales, para same tayo ng basis.",
      "#sales-date",
    ],
    [
      "Your business overview",
      "Check the sales summary with its selected period. Zero sales is valid; huwag gumawa ng sample paid orders para lang may laman.",
      "#sales-overview-title",
    ],
    [
      "Read the pattern",
      "Explore the charts at report details, then check the underlying orders kapag may tanong. A chart is a guide; review the transaction details too.",
      "#sales-trends-section",
    ],
  ],
  orders: [
    [
      "Know the order's stage",
      "Check whether you are viewing active, completed or cancelled orders. Open an order for its real items, notes and payment details.",
      '[data-walkthrough="shop-content"] h1',
    ],
    [
      "Keep payment at the counter",
      "Payment recording happens in Cashier. Confirm only after receiving the actual payment; browsing an order is not a payment action.",
      '[data-walkthrough="shop-cashier"]',
    ],
    [
      "Preparation has its own flow",
      "Kitchen / Barista handles queued, preparing, ready and completed handoffs. Update the actual stage, hindi advance para lang matapos ang list.",
      '[data-walkthrough="shop-kitchen"]',
    ],
  ],
  staff: [
    [
      "Right person, right access",
      "Review your staff list and each role. Keep owner-level decisions with the owner; a familiar email is not a reason to give more access than needed.",
      "#staff-list-title",
    ],
    [
      "Invite the exact email",
      "Enter the team member's own email, then choose the role carefully. Review both before sending the invitation after this guide.",
      "#invite-staff-title",
    ],
    [
      "Check pending invitations",
      "Review invitation status before resending or revoking. An invitation is not the same as an active membership.",
      "#invitations-title",
    ],
  ],
  tables: [
    [
      "Labels your team knows",
      "Use clear table labels. Double-check the selected shop before creating or printing anything.",
      "#tables-title",
    ],
    [
      "Create the right table",
      "After the guide, enter the table label here. Avoid duplicates para clear ang dine-in orders.",
      "#create-table-title",
    ],
    [
      "QR check before print",
      "Check the saved table and its QR before printing or placing it. The customer's order should point to the table they are actually using.",
      "#saved-tables-title",
    ],
  ],
  settings: [
    [
      "Make it feel like your place",
      "Dito ang shop details and presentation options. Review each section; changing settings can affect the customer's view.",
      "#settings-heading",
    ],
    [
      "Photos with purpose",
      "Check your logo and photos. Keep important content readable after cropping, and wait for the actual upload result.",
      "#settings-section-photos",
    ],
    [
      "Match how you serve",
      "Review the dine-in service mode against your real operations. Tell your team before changing how customers are expected to order.",
      "#settings-dineInServiceMode",
    ],
    [
      "Preview before saving",
      "Check the available menu layouts and preview your changes. Save only when ready, then verify the result instead of assuming an upload or setting saved.",
      "#preview-settings-changes",
    ],
  ],
};

export function shopPageSteps(
  page: OwnerWalkthroughPage,
  role: ShopRole,
): TourStep[] {
  if (!canAccessWalkthroughPage(role, page)) return [];
  return [
    ...lessons[page].map(([title, text, target], index) => ({
      id: `${page}-${index}`,
      title,
      text:
        role === "OWNER"
          ? text
          : text
              .replaceAll(", owner!", ", team!")
              .replaceAll("Menu preview", "public menu"),
      target:
        role !== "OWNER" &&
        page === "products" &&
        index === lessons[page].length - 1
          ? "#products-title"
          : target,
      fallbackTarget: '[data-walkthrough="shop-content"] h1',
      pose: index === 0 ? ("wave" as const) : undefined,
    })),
    {
      id: `${page}-done`,
      title: `Ready ka na, ${role.toLowerCase()}!`,
      text: "Guide done! You can explore at your own pace now. Check messages before repeating an action, and review the customer's menu after catalog changes.",
      pose: "done",
    },
  ];
}

/** Retained for owner-specific callers; all roles share contextual lessons. */
export function ownerPageSteps(page: OwnerWalkthroughPage): TourStep[] {
  return shopPageSteps(page, "OWNER");
}
