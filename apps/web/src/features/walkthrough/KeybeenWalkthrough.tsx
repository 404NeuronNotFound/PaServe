import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FiArrowLeft, FiArrowRight, FiCheck } from "react-icons/fi";
import type {
  ShopWalkthroughPage,
  CurrentUser,
  UserMembership,
  WalkthroughCompletionRequest,
  WalkthroughProgressResponse,
} from "@paserve/contracts";
import {
  WALKTHROUGH_VERSION,
  canAccessWalkthroughPage,
} from "@paserve/contracts";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { feedback } from "../../app/stores/feedback";
import { useSessionStore } from "../auth/stores/session";
import { accountSteps, placesSteps, shopSteps, type TourStep } from "./steps";
import { getWalkthroughProgress, finishWalkthrough } from "./api";
import { dismissHere, dismissedHere } from "./progress";
import { shopPageSteps } from "./owner-steps";
import { KeybeenSprite } from "./KeybeenSprite";
import { useSpotlight } from "./useSpotlight";
import "./walkthrough.css";

export function KeybeenWalkthrough({
  user,
  membership,
  surface = "account",
  page,
}: {
  user: CurrentUser;
  membership?: UserMembership;
  surface?: "account" | "places";
  page?: ShopWalkthroughPage;
}) {
  const sessionToken = useSessionStore((state) => state.accessToken);
  if (!sessionToken) return null;
  const permittedPage =
    membership && page && canAccessWalkthroughPage(membership.role, page)
      ? page
      : undefined;
  const scope = membership
    ? "shop:" +
      membership.shopId +
      ":" +
      membership.role +
      (permittedPage ? ":page:" + permittedPage : "")
    : surface;
  return (
    <ScopedWalkthrough
      key={user.id + ":" + scope}
      user={user}
      membership={membership}
      scope={scope}
      surface={surface}
      page={permittedPage}
    />
  );
}
function ScopedWalkthrough({
  user,
  membership,
  scope,
  surface,
  page,
}: {
  user: CurrentUser;
  membership?: UserMembership;
  scope: string;
  surface: "account" | "places";
  page?: ShopWalkthroughPage;
}) {
  const token = useSessionStore((state) => state.accessToken);
  const client = useQueryClient();
  const writes = useIsMutating();
  const key = ["keybeen", user.id, WALKTHROUGH_VERSION] as const;
  const [dismissed, setDismissed] = useState(() =>
    dismissedHere(user.id, scope),
  );
  const finishing = useRef(false);
  const progress = useQuery({
    queryKey: key,
    queryFn: getWalkthroughProgress,
    enabled: Boolean(token && !dismissed),
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const completion = useMutation({
    mutationFn: (input: WalkthroughCompletionRequest) =>
      finishWalkthrough(input),
    retry: 1,
    onSuccess: (result) =>
      client.setQueryData<WalkthroughProgressResponse>(key, (previous) => ({
        completedScopes: [
          ...new Set([...(previous?.completedScopes ?? []), result.scope]),
        ],
      })),
    onError: () =>
      feedback.toast(
        "Tour closed for now. We could not save your preference, so it may appear on another device.",
      ),
  });
  const steps = useMemo(
    () =>
      membership
        ? page
          ? shopPageSteps(page, membership.role)
          : shopSteps(membership.role, membership.shop.name, user.firstName)
        : surface === "places"
          ? placesSteps(user.firstName)
          : accountSteps(user.firstName),
    [membership, user.firstName, surface, page],
  );
  function finish(outcome: "completed" | "skipped") {
    if (finishing.current) return;
    finishing.current = true;
    dismissHere(user.id, scope);
    setDismissed(true);
    const input: WalkthroughCompletionRequest = {
      kind: membership ? "shop" : surface,
      outcome,
      ...(membership ? { shopId: membership.shopId } : {}),
      ...(page ? { page } : {}),
    };
    completion.mutate(input);
  }
  if (
    dismissed ||
    writes > 0 ||
    !progress.isSuccess ||
    !Array.isArray(progress.data?.completedScopes) ||
    progress.data.completedScopes.includes(scope)
  )
    return null;
  return <OpenWalkthrough steps={steps} onFinish={finish} />;
}
function OpenWalkthrough({
  steps,
  onFinish,
}: {
  steps: TourStep[];
  onFinish: (outcome: "completed" | "skipped") => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];
  const card = useRef<HTMLDivElement>(null);
  const spotlight = useSpotlight(step, card);
  const pose = step.pose ?? spotlight?.side ?? "think";
  const last = index >= steps.length - 1;
  return (
    <>
      {spotlight &&
        createPortal(
          <div
            className="keybeen-spotlight"
            aria-hidden="true"
            style={{
              left: spotlight.left,
              top: spotlight.top,
              width: spotlight.width,
              height: spotlight.height,
            }}
          />,
          document.body,
        )}
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onFinish("skipped");
        }}
      >
        <DialogContent
          ref={card}
          className="keybeen-guide"
          overlayClassName={
            spotlight ? "keybeen-overlay-spotlight" : "keybeen-overlay-welcome"
          }
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="keybeen-guide-body">
            <KeybeenSprite key={step.id} pose={pose} speech={step.text} />
            <div className="keybeen-speech">
              <p className="keybeen-eyebrow">KEYBEEN / PASERVE GUIDE</p>
              <p className="sr-only" role="status">
                Step {index + 1} of {steps.length}: {step.title}
              </p>
              <DialogTitle>{step.title}</DialogTitle>
              <DialogDescription>{step.text}</DialogDescription>
              {spotlight?.fallback && (
                <p className="keybeen-mobile-hint">
                  Sa phone, open Menu after the tour para makita ang section na
                  ito.
                </p>
              )}
            </div>
          </div>
          <footer className="keybeen-guide-actions">
            <span
              className="keybeen-progress"
              aria-label={"Step " + (index + 1) + " of " + steps.length}
            >
              {index + 1} / {steps.length}
            </span>
            <Button
              variant="ghost"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
            >
              <FiArrowLeft aria-hidden="true" /> Back
            </Button>
            <Button variant="outline" onClick={() => onFinish("skipped")}>
              Skip tour
            </Button>
            <Button
              onClick={() => {
                if (last) onFinish("completed");
                else setIndex((value) => value + 1);
              }}
            >
              {last ? "Tara, let's go!" : "Next"}{" "}
              {last ? (
                <FiCheck aria-hidden="true" />
              ) : (
                <FiArrowRight aria-hidden="true" />
              )}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
