import * as stylex from "@stylexjs/stylex";
import { Coffee, Gift, ShoppingBag, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { Reward } from "./domain";
import { formatPoints } from "./domain";

export function Button({
  children,
  onClick,
  disabled = false,
  secondary = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...stylex.props(
        ui.button,
        secondary && ui.secondary,
        disabled && ui.disabled,
      )}
    >
      {children}
    </button>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      aria-labelledby="dialog-title"
      {...stylex.props(ui.dialog)}
    >
      <div {...stylex.props(ui.dialogHeader)}>
        <h2 id="dialog-title" {...stylex.props(ui.dialogTitle)}>
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          {...stylex.props(ui.close)}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function RewardArt({
  id,
  small = false,
}: {
  id: string;
  small?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      {...stylex.props(
        ui.art,
        id === "coffee" ? ui.peach : id === "discount" ? ui.lavender : ui.sage,
        small && ui.smallArt,
      )}
    >
      {id === "coffee" ? (
        <div {...stylex.props(ui.coffee)}>
          <Coffee size={small ? 38 : 78} strokeWidth={1.3} />
        </div>
      ) : id === "discount" ? (
        <span {...stylex.props(ui.discount, small && ui.smallDiscount)}>
          10<span {...stylex.props(ui.percent)}>%</span>
        </span>
      ) : (
        <div {...stylex.props(ui.tote)}>
          <ShoppingBag size={small ? 34 : 74} strokeWidth={1.2} />
        </div>
      )}
      {!small && (
        <span {...stylex.props(ui.artLabel)}>
          {id === "coffee"
            ? "A cup of something good"
            : id === "discount"
              ? "More of what you love"
              : "A daily companion"}
        </span>
      )}
    </div>
  );
}

export function RewardCard({
  reward,
  points,
  onSelect,
  disabled,
}: {
  reward: Reward;
  points: string | null;
  onSelect: () => void;
  disabled: boolean;
}) {
  const affordable = points !== null && BigInt(points) >= BigInt(reward.points);
  return (
    <article {...stylex.props(ui.reward)}>
      <RewardArt id={reward.id} />
      <div {...stylex.props(ui.rewardBody)}>
        <p {...stylex.props(ui.category)}>{reward.category}</p>
        <h3 {...stylex.props(ui.rewardTitle)}>{reward.title}</h3>
        <div {...stylex.props(ui.rewardFooter)}>
          <span {...stylex.props(ui.cost)}>
            <Gift size={15} />
            {formatPoints(reward.points)}{" "}
            <span {...stylex.props(ui.pointsLabel)}>pts</span>
          </span>
          <button
            type="button"
            onClick={onSelect}
            disabled={disabled}
            {...stylex.props(
              ui.redeem,
              affordable && ui.redeemReady,
              disabled && ui.disabled,
            )}
          >
            {points === null
              ? "View reward"
              : affordable
                ? "Redeem"
                : "View details"}
          </button>
        </div>
      </div>
    </article>
  );
}

export const ui = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    minHeight: 43,
    padding: "11px 19px",
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#405a42",
    backgroundColor: { default: "#405a42", ":hover": "#304832" },
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    transition: "background-color .15s",
  },
  secondary: {
    backgroundColor: { default: "transparent", ":hover": "#edf0e7" },
    color: "#405a42",
    borderColor: "#d8dfd1",
  },
  disabled: { opacity: 0.5 },
  dialog: {
    width: "min(480px, calc(100vw - 32px))",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dce2d5",
    borderRadius: 18,
    padding: 28,
    color: "#232b25",
    backgroundColor: "#fff",
    boxShadow: "0 24px 80px #24332626",
  },
  dialogHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 22,
  },
  dialogTitle: { fontSize: 22, fontWeight: 600, letterSpacing: "-.7px" },
  close: {
    borderWidth: 0,
    padding: 5,
    backgroundColor: "transparent",
    display: "flex",
    borderRadius: 6,
  },
  art: {
    height: 178,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#634736",
  },
  peach: { backgroundColor: "#f2e4d8" },
  lavender: { backgroundColor: "#e9e4f4", color: "#655585" },
  sage: { backgroundColor: "#e5eadc", color: "#516747" },
  coffee: {
    transform: "rotate(-12deg)",
    backgroundColor: "#fff8ef",
    width: 106,
    height: 106,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    boxShadow: "6px 9px 0 #e7d1be",
  },
  tote: { transform: "rotate(9deg)" },
  discount: {
    fontWeight: 500,
    letterSpacing: "-6px",
    fontSize: 86,
    lineHeight: 1,
    transform: "rotate(-7deg)",
  },
  percent: { fontSize: ".58em", letterSpacing: "-3px" },
  smallDiscount: { fontSize: 38, letterSpacing: "-2px" },
  smallArt: { height: 64, width: 64, flexShrink: 0, borderRadius: 12 },
  artLabel: {
    position: "absolute",
    bottom: 13,
    fontSize: 10,
    letterSpacing: ".3px",
    opacity: 0.8,
  },
  reward: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e3e6dc",
    borderRadius: 13,
    overflow: "hidden",
    backgroundColor: "#fff",
    minWidth: 0,
  },
  rewardBody: { padding: "19px 20px" },
  category: { fontSize: 11, color: "#737c71", marginBottom: 7 },
  rewardTitle: {
    fontSize: 16,
    fontWeight: 550,
    letterSpacing: "-.3px",
    minHeight: 40,
  },
  rewardFooter: {
    marginTop: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cost: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
  },
  pointsLabel: { fontSize: 11, fontWeight: 400, color: "#737c71" },
  redeem: {
    padding: "8px 12px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e0e5d9",
    borderRadius: 7,
    backgroundColor: { default: "#fff", ":hover": "#f2f5ed" },
    color: "#405a42",
    fontSize: 11,
    fontWeight: 600,
  },
  redeemReady: {
    backgroundColor: { default: "#eef3e5", ":hover": "#e4edda" },
    borderColor: "#eef3e5",
  },
  body: { color: "#65705f", lineHeight: 1.7, fontSize: 14 },
  stack: { display: "flex", flexDirection: "column", gap: 16 },
  dialogActions: {
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
    marginTop: 24,
  },
  input: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dce2d5",
    borderRadius: 8,
    padding: "10px 13px",
    backgroundColor: "#fff",
    fontSize: 13,
    minWidth: 0,
  },
});
