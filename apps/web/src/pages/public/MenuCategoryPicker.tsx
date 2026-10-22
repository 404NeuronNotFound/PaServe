import { useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiGrid } from "react-icons/fi";
import { Button } from "../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../../components/ui/sheet";
import { menuTheme } from "../../lib/menu-theme";
import type { PublicMenuResponse } from "@paserve/contracts";

export function MenuCategoryPicker({
  sections,
  activeId,
  onSelect,
  shop,
}: {
  sections: Array<{ id: string; name: string; count: number }>;
  activeId: string | undefined;
  onSelect: (id: string) => void;
  shop: PublicMenuResponse["shop"];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const destination = useRef<string | null>(null);
  const active =
    sections.find((section) => section.id === activeId) ?? sections[0];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="menu-category-summary">
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            className="menu-current-category"
            aria-label={`Choose category, currently ${active?.name ?? "Menu"}`}
            onClick={(event) => {
              trigger.current = event.currentTarget;
            }}
          >
            <span>
              <small>Browsing</small>
              <strong>{active?.name ?? "Menu"}</strong>
            </span>
            <FiChevronDown aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            type="button"
            className="menu-all-categories"
            onClick={(event) => {
              trigger.current = event.currentTarget;
            }}
          >
            <FiGrid aria-hidden="true" /> All categories
          </Button>
        </SheetTrigger>
      </div>
      <SheetContent
        side="bottom"
        className="menu-category-sheet"
        style={menuTheme(shop.primaryColor, shop.accentColor)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const heading = destination.current
            ? document.getElementById(destination.current)
            : null;
          destination.current = null;
          if (heading) {
            heading.scrollIntoView?.({ block: "start", behavior: "instant" });
            heading.focus({ preventScroll: true });
          } else trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="menu-category-sheet-handle" aria-hidden="true" />
        <SheetTitle>Explore the menu</SheetTitle>
        <SheetDescription>
          Jump to a category. You can also scroll to browse the full menu.
        </SheetDescription>
        <nav className="menu-category-grid" aria-label="All menu categories">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-label={`${section.name}, ${section.count} ${section.count === 1 ? "item" : "items"}`}
              aria-current={section.id === activeId ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                destination.current = section.id;
                onSelect(section.id);
                setOpen(false);
              }}
            >
              <span>
                <strong>{section.name}</strong>
                <small>
                  {section.count} {section.count === 1 ? "item" : "items"}
                </small>
              </span>
              {section.id === activeId && <FiCheck aria-hidden="true" />}
            </a>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
