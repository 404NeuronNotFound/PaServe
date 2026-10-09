import type { ComponentProps, Ref } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo } from "react-icons/fi";
import type { FeedbackTone } from "../../app/stores/feedback";

export function InlineMessage({
  tone = "error",
  className = "form-error",
  children,
  ref,
  ...props
}: ComponentProps<"p"> & {
  tone?: FeedbackTone;
  ref?: Ref<HTMLParagraphElement>;
}) {
  const Icon =
    tone === "error" || tone === "warning"
      ? FiAlertCircle
      : tone === "success"
        ? FiCheckCircle
        : FiInfo;
  return (
    <p
      ref={ref}
      role={tone === "error" ? "alert" : "status"}
      {...props}
      className={`feedback-inline feedback-${tone} ${className}`}
    >
      <Icon aria-hidden="true" /> <span>{children}</span>
    </p>
  );
}
