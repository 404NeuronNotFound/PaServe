import { useId, type ReactNode } from "react";
import "./empty-state.css";

/** Only render after a successful read: errors and denied access are not empty. */
export function EmptyState({
  title,
  description,
  icon,
  children,
  headingLevel = 3,
}: {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  children?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="empty-state" aria-labelledby={id}>
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <Heading id={id}>{title}</Heading>
      <p className="empty-state-description">{description}</p>
      {children && <div className="empty-state-actions">{children}</div>}
    </section>
  );
}
