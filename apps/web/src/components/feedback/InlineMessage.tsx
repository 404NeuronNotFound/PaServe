import type { ComponentProps, Ref } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo } from "react-icons/fi";
import type { FeedbackTone } from "../../app/stores/feedback";
import { Alert } from "../ui/alert";

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
    <Alert asChild unstyled role={tone === "error" ? "alert" : "status"}>
    <p
      ref={ref}
      {...props}
      className={`feedback-inline feedback-${tone} ${className}`}
    >
      <Icon aria-hidden="true" /> <span>{children}</span>
    </p>
    </Alert>
  );
}
