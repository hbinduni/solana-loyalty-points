import * as stylex from "@stylexjs/stylex";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Coffee,
  ExternalLink,
  Gift,
  Leaf,
  LockKeyhole,
  Orbit,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import type { MemberData, Operation, Reward } from "./domain";
import { formatPoints, shortWallet } from "./domain";
import { Button, RewardCard, ui } from "./ui";

export function Membership({
  data,
  address,
  demo,
  onConnect,
  onRewards,
}: {
  data: MemberData | null;
  address: string;
  demo: boolean;
  onConnect: () => void;
  onRewards: () => void;
}) {
  return (
    <div {...stylex.props(s.overview)}>
      <section aria-label="Your membership card" {...stylex.props(s.card)}>
        <div {...stylex.props(s.cardTop)}>
          <span {...stylex.props(s.cardBrand)}>
            <Orbit size={23} />
            orbit
          </span>
          <span {...stylex.props(s.cardBadge)}>
            <LockKeyhole size={12} /> Just for you
          </span>
        </div>
        <div {...stylex.props(s.cardBalance)}>
          <p {...stylex.props(s.cardLabel)}>
            {data ? "Your available points" : "Your everyday, rewarded"}
          </p>
          {data ? (
            <p {...stylex.props(s.balance)}>
              {data.points === null ? "Unavailable" : formatPoints(data.points)}
              {data.points !== null && (
                <span {...stylex.props(s.pts)}>pts</span>
              )}
            </p>
          ) : (
            <h2 {...stylex.props(s.guestHeadline)}>
              Good things
              <br />
              come around.
            </h2>
          )}
        </div>
        <div aria-hidden="true" {...stylex.props(s.orbitArt)}>
          <div {...stylex.props(s.orbitInner)}>
            <Sparkles size={46} strokeWidth={1.25} />
          </div>
          <span {...stylex.props(s.orbitDot)} />
        </div>
        <div {...stylex.props(s.cardBottom)}>
          <span {...stylex.props(s.cardMember)}>
            {demo
              ? "Preview membership"
              : address
                ? shortWallet(address)
                : "A membership that stays with you"}
          </span>
          <button
            type="button"
            onClick={data ? onRewards : onConnect}
            {...stylex.props(s.cardAction)}
          >
            {data ? "Find your next reward" : "Connect your wallet"}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
      <section {...stylex.props(s.habit)}>
        <Leaf size={25} strokeWidth={1.5} />
        <h2 {...stylex.props(s.habitTitle)}>
          Small moments.
          <br />
          Lovely little perks.
        </h2>
        <p {...stylex.props(s.habitCopy)}>
          Your morning coffee. A favorite find. Make your next visit a little
          more rewarding.
        </p>
        <div {...stylex.props(s.habitFooter)}>
          <span {...stylex.props(s.habitDot)} />
          Your points live in your wallet
        </div>
      </section>
    </div>
  );
}

export function Rewards({
  rewards,
  points,
  onSelect,
  full = false,
  busy,
}: {
  rewards: Reward[];
  points: string | null;
  onSelect: (reward: Reward) => void;
  full?: boolean;
  busy: boolean;
}) {
  const [filter, setFilter] = useState("All rewards");
  const filtered =
    filter === "All rewards"
      ? rewards
      : rewards.filter((r) => r.category === filter);
  return (
    <section>
      {full && (
        <div {...stylex.props(s.filters)}>
          {["All rewards", "Food & drink", "Shopping", "Merch"].map(
            (category) => (
              <button
                type="button"
                key={category}
                aria-pressed={filter === category}
                onClick={() => setFilter(category)}
                {...stylex.props(
                  s.filter,
                  filter === category && s.activeFilter,
                )}
              >
                {category}
              </button>
            ),
          )}
        </div>
      )}
      {filtered.length ? (
        <div {...stylex.props(s.rewardGrid)}>
          {filtered.map((reward) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              points={points}
              onSelect={() => onSelect(reward)}
              disabled={busy}
            />
          ))}
        </div>
      ) : (
        <div {...stylex.props(s.empty)}>
          <Gift size={26} />
          <p>No rewards to show yet.</p>
          <span>The reward catalog will appear here when it is available.</span>
        </div>
      )}
    </section>
  );
}

export function Activity({
  data,
  full = false,
  demo,
  onClaim,
  onResume,
}: {
  data: MemberData | null;
  full?: boolean;
  demo: boolean;
  onClaim: (o: Operation) => void;
  onResume: (o: Operation) => void;
}) {
  const [filter, setFilter] = useState("All activity");
  const [search, setSearch] = useState("");
  const rows = (data?.activity ?? []).filter(
    (o) =>
      (filter === "All activity" ||
        o.kind === (filter === "Earned" ? "earn" : "redeem")) &&
      o.title.toLowerCase().includes(search.toLowerCase()),
  );
  const visible = full ? rows : rows.slice(0, 4);
  return (
    <section {...stylex.props(s.activity)}>
      {full && (
        <div {...stylex.props(s.activityTools)}>
          <div {...stylex.props(s.filters, s.noMargin)}>
            {["All activity", "Earned", "Redeemed"].map((label) => (
              <button
                type="button"
                key={label}
                aria-pressed={filter === label}
                onClick={() => setFilter(label)}
                {...stylex.props(s.filter, filter === label && s.activeFilter)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            aria-label="Search activity"
            placeholder="Search your activity"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            {...stylex.props(ui.input)}
          />
        </div>
      )}
      {visible.length ? (
        visible.map((item) => (
          <div key={item.id} {...stylex.props(s.activityRow)}>
            <div
              {...stylex.props(
                s.activityIcon,
                item.kind === "redeem" && s.redeemIcon,
              )}
            >
              {item.kind === "earn" ? (
                <ArrowDownLeft size={19} />
              ) : (
                <Gift size={18} />
              )}
            </div>
            <div {...stylex.props(s.activityDescription)}>
              <p {...stylex.props(s.activityTitle)}>{item.title}</p>
              <p {...stylex.props(s.activityMeta)}>
                {new Date(item.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                <span {...stylex.props(s.metaDot)} />
                {item.fulfilledAt
                  ? "Collected"
                  : item.status === "confirmed"
                    ? item.kind === "earn"
                      ? "Points earned"
                      : "Reward ready"
                    : item.status === "prepared"
                      ? "Awaiting signature"
                      : item.status === "pending"
                        ? "Confirming on Solana"
                        : item.status === "expired"
                          ? "Expired"
                          : "Failed"}
                {demo ? " (demo)" : ""}
              </p>
            </div>
            {item.claimCode && (
              <button
                type="button"
                onClick={() => onClaim(item)}
                {...stylex.props(s.textButton)}
              >
                {item.fulfilledAt ? "View receipt" : "View reward"}
              </button>
            )}
            {item.status === "prepared" && (
              <button
                type="button"
                onClick={() => onResume(item)}
                {...stylex.props(s.textButton)}
              >
                Continue
              </button>
            )}
            <span
              {...stylex.props(
                s.activityPoints,
                item.kind === "earn" && s.earned,
                item.status !== "confirmed" && s.unsettled,
              )}
            >
              {item.status === "confirmed"
                ? item.kind === "earn"
                  ? "+"
                  : "−"
                : ""}
              {formatPoints(item.points)}
              <span {...stylex.props(s.activityPointsUnit)}> pts</span>
            </span>
            {item.signature ? (
              <a
                href={`https://explorer.solana.com/tx/${encodeURIComponent(item.signature)}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${item.title} transaction on Solana Explorer`}
                {...stylex.props(s.explorer)}
              >
                <ExternalLink size={14} />
              </a>
            ) : (
              <span {...stylex.props(s.explorer)}>
                {item.status === "confirmed" ? (
                  <Check size={14} />
                ) : (
                  <CircleHelp size={14} />
                )}
              </span>
            )}
          </div>
        ))
      ) : (
        <div {...stylex.props(s.empty)}>
          <Orbit size={26} />
          <p>
            {data
              ? "Your next visit starts the story."
              : "Your points have a story."}
          </p>
          <span>
            {search
              ? "No activity matches your search."
              : "Earned points and redeemed rewards will appear here."}
          </span>
        </div>
      )}
    </section>
  );
}

export function HowItWorks({ onConnect }: { onConnect: () => void }) {
  return (
    <div {...stylex.props(s.how)}>
      <div {...stylex.props(s.howIntro)}>
        <Leaf size={40} strokeWidth={1.25} />
        <h2 {...stylex.props(s.howTitle)}>
          A thank-you for
          <br />
          coming back.
        </h2>
        <p {...stylex.props(ui.body)}>
          Orbit brings the familiar loyalty card to your Solana wallet. Collect
          points from the places you love, then turn them into a little
          something for yourself.
        </p>
        <Button onClick={onConnect}>
          <Wallet size={16} />
          Connect your wallet
        </Button>
      </div>
      <div {...stylex.props(s.steps)}>
        {[
          {
            icon: Wallet,
            title: "Make yourself at home",
            body: "Connect a compatible Solana wallet and sign a message to join. Signing in is free and never moves your tokens.",
          },
          {
            icon: Coffee,
            title: "Come by. Collect points.",
            body: "After a qualifying purchase, the merchant sends points to your wallet. Your finalized balance appears on your membership card.",
          },
          {
            icon: Gift,
            title: "Pick your next good thing",
            body: "Choose a reward and approve the redemption in your wallet. Redeemed points are burned. Orbit pays the network fee, so you don’t need SOL.",
          },
          {
            icon: ShieldCheck,
            title: "Keep it personal",
            body: "Points cannot be transferred or sold. Once your redemption is finalized, show the reward code to the merchant to collect it.",
          },
        ].map(({ icon: Icon, title, body }, index) => (
          <div key={title} {...stylex.props(s.step)}>
            <div {...stylex.props(s.stepIcon)}>
              <Icon size={22} strokeWidth={1.5} />
            </div>
            <div>
              <span {...stylex.props(s.stepNumber)}>Step {index + 1}</span>
              <h3 {...stylex.props(s.stepTitle)}>{title}</h3>
              <p {...stylex.props(ui.body)}>{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  onAction,
  subtitle,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  subtitle?: string;
}) {
  return (
    <div {...stylex.props(s.sectionHeading)}>
      <div>
        <h2 {...stylex.props(s.sectionTitle)}>{title}</h2>
        {subtitle && <p {...stylex.props(s.sectionSubtitle)}>{subtitle}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={onAction}
          {...stylex.props(s.textButton)}
        >
          {action}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

const s = stylex.create({
  overview: {
    display: "grid",
    gridTemplateColumns: {
      default: "1.65fr 1fr",
      "@media (max-width: 1000px)": "1.5fr 1fr",
      "@media (max-width: 640px)": "1fr",
    },
    gap: 22,
    marginBottom: 38,
  },
  card: {
    minHeight: 260,
    borderRadius: 17,
    backgroundColor: "#d9f27e",
    padding: "25px 28px",
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    color: "#293d26",
  },
  cardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 1,
  },
  cardBrand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 23,
    fontWeight: 600,
    letterSpacing: "-1.2px",
  },
  cardBadge: {
    display: "flex",
    gap: 5,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#9caf6666",
    borderRadius: 20,
    padding: "5px 8px",
    fontSize: 10,
  },
  cardBalance: {
    paddingTop: 24,
    paddingBottom: 20,
    position: "relative",
    zIndex: 1,
  },
  cardLabel: { fontSize: 12, marginBottom: 3 },
  balance: {
    fontSize: { default: 62, "@media (max-width: 460px)": 48 },
    fontWeight: 500,
    letterSpacing: "-3.4px",
    lineHeight: 1.15,
    overflowWrap: "anywhere",
  },
  pts: { fontSize: 18, letterSpacing: "-.3px", marginLeft: 8 },
  guestHeadline: {
    fontSize: 38,
    lineHeight: 1.1,
    fontWeight: 500,
    letterSpacing: "-1.6px",
  },
  cardBottom: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 1,
    flexWrap: "wrap",
  },
  cardMember: { fontSize: 10, opacity: 0.8 },
  cardAction: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
  },
  orbitArt: {
    position: "absolute",
    width: 184,
    height: 184,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#879e3e4d",
    borderRadius: "50%",
    right: -12,
    top: 62,
    transform: "rotate(-30deg)",
    display: "grid",
    placeItems: "center",
    opacity: { default: 1, "@media (max-width: 460px)": 0.45 },
  },
  orbitInner: {
    display: "grid",
    placeItems: "center",
    width: 144,
    height: 144,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#879e3e4d",
    borderRadius: "50%",
    color: "#768b38",
  },
  orbitDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: "50%",
    backgroundColor: "#a2b74e",
    top: 24,
    right: 14,
  },
  habit: {
    padding: "23px 26px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dce2d5",
    borderRadius: 16,
    backgroundColor: "#f0f3e9",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    color: "#526447",
  },
  habitTitle: {
    fontSize: 25,
    fontWeight: 500,
    lineHeight: 1.18,
    letterSpacing: "-.8px",
    marginTop: 16,
    marginBottom: 10,
  },
  habitCopy: { fontSize: 12, lineHeight: 1.7, color: "#6b7662", maxWidth: 240 },
  habitFooter: {
    fontSize: 10,
    marginTop: "auto",
    paddingTop: 20,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  habitDot: {
    width: 5,
    height: 5,
    backgroundColor: "#6f8759",
    borderRadius: "50%",
  },
  rewardGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, minmax(0, 1fr))",
      "@media (max-width: 1050px)": "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 540px)": "1fr",
    },
    gap: 20,
  },
  filters: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  filter: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dfe5d7",
    borderRadius: 7,
    padding: "9px 14px",
    backgroundColor: "#fff",
    fontSize: 12,
    color: "#697560",
  },
  activeFilter: {
    color: "#fff",
    backgroundColor: "#405a42",
    borderColor: "#405a42",
  },
  noMargin: { marginBottom: 0 },
  activity: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e3e6dc",
    borderRadius: 13,
    paddingInline: { default: 23, "@media (max-width: 540px)": 13 },
  },
  activityTools: {
    display: "flex",
    justifyContent: "space-between",
    gap: 15,
    paddingBlock: 20,
    flexWrap: "wrap",
  },
  activityRow: {
    display: "flex",
    alignItems: "center",
    gap: { default: 13, "@media (max-width: 540px)": 8 },
    paddingBlock: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "#f0f1ec",
  },
  activityIcon: {
    width: 37,
    height: 37,
    borderRadius: "50%",
    backgroundColor: "#edf3e7",
    color: "#60784d",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  redeemIcon: { backgroundColor: "#f2eef8", color: "#8877a8" },
  activityDescription: { flexGrow: 1, minWidth: 0 },
  activityTitle: { fontSize: 12, fontWeight: 500 },
  activityMeta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    fontSize: 10,
    marginTop: 5,
    color: "#737c71",
    gap: 7,
  },
  metaDot: {
    width: 2,
    height: 2,
    backgroundColor: "#a3aa9b",
    borderRadius: "50%",
  },
  activityPoints: { fontSize: 13, fontWeight: 550, whiteSpace: "nowrap" },
  earned: { color: "#527344" },
  unsettled: { color: "#737c71" },
  activityPointsUnit: { fontSize: 10, color: "#737c71", fontWeight: 400 },
  explorer: {
    color: "#9da694",
    width: 15,
    flexShrink: 0,
    display: { default: "inline-flex", "@media (max-width: 540px)": "none" },
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "45px 22px",
    textAlign: "center",
    color: "#73806a",
    fontSize: 13,
  },
  sectionHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    marginBottom: 19,
  },
  sectionTitle: { fontSize: 20, fontWeight: 550, letterSpacing: "-.7px" },
  sectionSubtitle: { fontSize: 12, color: "#737c71", marginTop: 5 },
  textButton: {
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: "5px 0",
    display: "inline-flex",
    gap: 5,
    alignItems: "center",
    fontSize: 11,
    color: "#526447",
    fontWeight: 550,
    textAlign: "left",
  },
  how: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1.25fr",
      "@media (max-width: 800px)": "1fr",
    },
    gap: 45,
    paddingTop: 15,
  },
  howIntro: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 25,
    padding: 28,
    backgroundColor: "#edf2e4",
    borderRadius: 18,
  },
  howTitle: {
    fontSize: 36,
    lineHeight: 1.1,
    fontWeight: 500,
    letterSpacing: "-1.4px",
  },
  steps: { display: "flex", flexDirection: "column", gap: 26 },
  step: { display: "flex", gap: 18 },
  stepIcon: {
    minWidth: 45,
    height: 45,
    borderRadius: "50%",
    backgroundColor: "#e9eede",
    display: "grid",
    placeItems: "center",
    color: "#566d47",
  },
  stepNumber: { fontSize: 11, color: "#73806a" },
  stepTitle: { fontSize: 17, marginBlock: "5px 8px", fontWeight: 550 },
});
