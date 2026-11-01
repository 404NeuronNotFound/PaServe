import type { ShopRole } from "@paserve/contracts";
import { navigationForRole } from "../../components/layout/workspace-navigation";
export type KeybeenPose = "wave" | "left" | "right" | "think" | "done";
export type TourStep = {
  id: string;
  title: string;
  text: string;
  target?: string;
  pose?: KeybeenPose;
};
const copy: Record<string, [string, string]> = {
  sales: [
    "Kamusta ang sales?",
    "Dito mo makikita ang sales reports. Piliin muna ang tamang date range para same tayo ng numbers, okay?",
  ],
  orders: [
    "Order check, bestie",
    "Sa Orders, follow mo ang status at details ng bawat order. Check muna bago mag-update, lalo na kapag may customer na nagtatanong.",
  ],
  cashier: [
    "Counter mode, let's go!",
    "Open Cashier, scan the customer's order QR, then review the order and total. I-record lang ang payment kapag natanggap na talaga. No advance paid marks, ha!",
  ],
  kitchen: [
    "Kitchen / Barista, ready?",
    "Open the prep queue, check items at special notes, then start preparation. Mark Ready kapag ready na, at Complete kapag na-release na. One clear update at a time!",
  ],
  products: [
    "Ayusin natin ang menu",
    "Sa Menu & catalog, manage products, categories, at add-ons. Double-check prices and availability bago i-save para clear sa customers.",
  ],
  tables: [
    "Tables, organized",
    "Dito ang table labels at QR codes. Make sure tama ang table bago i-print o ibigay ang QR, para walang lipat-table confusion.",
  ],
  staff: [
    "Meet your team",
    "Sa Staff & invitations, invite the right email and choose the right role. Access depends sa role nila, so review muna before sending.",
  ],
  settings: [
    "Your shop, your setup",
    "Sa Shop settings, update the details and options available sa role mo. Review changes before saving para smooth ang service.",
  ],
};
const roleWelcome: Record<ShopRole, string> = {
  OWNER:
    "Owner ka rito! Quick tour tayo ng shop, team, menu, at reports na available sa account mo.",
  ADMIN:
    "Admin mode tayo! Guide kita sa daily operations at management tools na available sa role mo.",
  MANAGER:
    "Manager ka rito! Keep the team and service organized gamit ang tools na allowed sa workspace mo.",
  CASHIER:
    "Ikaw ang front-counter MVP! Guide kita sa orders at payments, step by step.",
  KITCHEN:
    "Kitchen / Barista ka rito! Let's keep the prep queue clear at ang orders on time.",
};
export function accountSteps(firstName?: string | null): TourStep[] {
  return [
    {
      id: "hello",
      title: "Uy, welcome" + (firstName ? ", " + firstName : "") + "!",
      text: "Ako si Keybeen, your PaServe buddy. Quick ikot lang tayo! You can skip anytime; walang gagalawin na orders or settings.",
      pose: "wave",
    },
    {
      id: "account",
      title: "Your personal space",
      text: "Ito ang account mo. Separate ito sa shop workspace, so dito muna ang personal details at places mo.",
      target: '[data-walkthrough="account-content"] h1',
      pose: "think",
    },
    {
      id: "profile",
      title: "Ikaw muna, syempre",
      text: "Sa Your profile, check your name and account details. Keep these updated para kilala ka ng team.",
      target: '[data-walkthrough="account-profile"]',
    },
    {
      id: "places",
      title: "Your shops, one place",
      text: "Sa Your places, makikita ang shop memberships mo. Puwede ring gumawa ng shop; kung staff ka, gamitin ang invitation ng team mo.",
      target: '[data-walkthrough="account-places"]',
    },
    {
      id: "notifications",
      title: "May update ba?",
      text: "Check Notifications para sa invitations at account updates. Open mo lang kapag ready ka na after this tour.",
      target: '[data-walkthrough="account-notifications"]',
    },
    {
      id: "appearance",
      title: "Day or Night, ikaw bahala",
      text: "Pili ka ng Day or Night appearance, whichever comfy sa eyes mo. Same tools pa rin, different vibe lang.",
      target: ".workspace-header .appearance-toggle",
    },
    {
      id: "done",
      title: "All set, tara!",
      text: "Account tour done! Open your places, then pili ng shop. May separate guide rin for your role doon. Kaya mo 'yan!",
      pose: "done",
    },
  ];
}
export function shopSteps(
  role: ShopRole,
  shopName: string,
  firstName?: string | null,
): TourStep[] {
  const available = new Set(
    navigationForRole(role).flatMap((group) =>
      group.items.map((item) => item.path),
    ),
  );
  const priorities: Record<ShopRole, string[]> = {
    OWNER: ["orders", "products", "staff", "sales", "settings"],
    ADMIN: ["orders", "products", "staff", "sales", "settings"],
    MANAGER: ["orders", "kitchen", "products", "tables"],
    CASHIER: ["cashier"],
    KITCHEN: ["kitchen"],
  };
  return [
    {
      id: "hello",
      title: "Welcome sa " + shopName + "!",
      text:
        (firstName ? firstName + ", " : "") +
        roleWelcome[role] +
        " Ako si Keybeen, kasama mo rito.",
      pose: "wave",
    },
    {
      id: "shop",
      title: "Tamang shop muna",
      text: "Check the active shop before working. Kung may ibang shops ka, switch dito; bawat shop has its own workspace and role mo.",
      target: '[data-walkthrough="active-shop"]',
    },
    ...priorities[role]
      .filter((path) => available.has(path))
      .map((path) => ({
        id: path,
        title: copy[path][0],
        text: copy[path][1],
        target:
          path === "products"
            ? '[data-walkthrough="shop-group-menu"]'
            : path === "staff" || path === "settings" || path === "tables"
              ? '[data-walkthrough="shop-group-management"]'
              : '[data-walkthrough="shop-' + path + '"]',
      })),
    {
      id: "workspace",
      title: "Ito ang workspace mo",
      text: "Ang nakikita mong tools ay para sa current role mo. Check the page instructions and empty states; walang need hulaan or gumawa ng sample orders.",
      target: '[data-walkthrough="shop-content"] h1',
      pose: "think",
    },
    {
      id: "account",
      title: "Balik sa account",
      text: "Your account and Your shops ang way back sa personal space at ibang memberships mo. Remember: same account, puwedeng ibang role per shop.",
      target: '[data-walkthrough="shop-account"]',
    },
    {
      id: "done",
      title: "Game, ready ka na!",
      text: "Tour done! Take your time, double-check details, and ask your team kapag unsure. Enjoy your shift, andito lang ang guide mo sa first visit!",
      pose: "done",
    },
  ];
}

export function placesSteps(firstName?: string | null): TourStep[] {
  return [
    accountSteps(firstName)[0],
    {
      id: "choose",
      title: "Saan tayo today?",
      text: "Ito ang shop picker mo. Choose the right shop bago mag-work; magkakaiba ang role at workspace mo sa bawat place.",
      target: '[data-walkthrough="places-title"]',
    },
    {
      id: "list",
      title: "Check your memberships",
      text: "Bawat card shows your shop and role. Active memberships lang ang puwedeng buksan. Pili ka kapag ready ka na after this tour.",
      target: '[data-walkthrough="places-list"]',
      pose: "think",
    },
    {
      id: "create",
      title: "May sarili kang shop?",
      text: "Use Create shop kung ikaw ang magse-set up ng bagong place. Kung invited staff ka, open your existing membership instead.",
      target: '[data-walkthrough="places-create"]',
    },
    {
      id: "account",
      title: "Personal space mo",
      text: "Your account ang shortcut sa profile, places, at notifications mo. Shop permissions stay separate, so check your role lagi.",
      target: '[data-walkthrough="places-account"]',
    },
    {
      id: "done",
      title: "Choose your next stop!",
      text: "All set! Pili ka na ng shop. Pagpasok mo, may guide tayo para sa actual role mo roon.",
      pose: "done",
    },
  ];
}
