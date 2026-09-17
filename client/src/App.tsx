import * as stylex from "@stylexjs/stylex";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Copy,
  Gift,
  History,
  LayoutGrid,
  Leaf,
  LogOut,
  Orbit,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Operation, Reward } from "./domain";
import { formatPoints, shortWallet } from "./domain";
import { Button, Dialog, RewardArt, ui } from "./ui";
import { useOrbit } from "./useOrbit";
import {
  Activity,
  HowItWorks,
  Membership,
  Rewards,
  SectionHeading,
} from "./views";
import { availableWallets, registry } from "./wallet";

type Page = "Overview" | "Rewards" | "Activity" | "How it works";
const navigation = [
  { name: "Overview", icon: LayoutGrid },
  { name: "Rewards", icon: Gift },
  { name: "Activity", icon: History },
  { name: "How it works", icon: CircleHelp },
] as const;

export function App() {
  const orbit = useOrbit();
  const [page, setPage] = useState<Page>("Overview");
  const [walletDialog, setWalletDialog] = useState(false);
  const [selected, setSelected] = useState<Reward | null>(null);
  const [claim, setClaim] = useState<Operation | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [wallets, setWallets] = useState(availableWallets);

  useEffect(() => {
    const update = () => setWallets(availableWallets());
    const offRegister = registry.on("register", update);
    const offUnregister = registry.on("unregister", update);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Account changes must discard private reward dialogs.
  useEffect(() => {
    setClaim(null);
    setSelected(null);
  }, [orbit.mode, orbit.address]);

  function navigate(next: Page) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const openWallet = () => {
    orbit.clearError();
    setWalletDialog(true);
  };
  const showClaim = (item: Operation) => {
    setCopied(false);
    setCopyError("");
    setClaim(item);
  };
  const ready =
    orbit.mode === "demo" ||
    (orbit.mode === "member" &&
      !!orbit.connection &&
      !!orbit.config?.configured);
  const affordable =
    selected &&
    orbit.data?.points != null &&
    BigInt(orbit.data.points) >= BigInt(selected.points);

  return (
    <div {...stylex.props(s.app)}>
      <aside {...stylex.props(s.sidebar)}>
        <button
          type="button"
          onClick={() => navigate("Overview")}
          aria-label="Orbit home"
          {...stylex.props(s.logo)}
        >
          <Orbit size={31} strokeWidth={1.8} />
          orbit
          <span {...stylex.props(s.logoDot)} />
        </button>
        <div {...stylex.props(s.sidebarMiddle)}>
          <p {...stylex.props(s.workspaceLabel)}>A little more, every day.</p>
          <nav aria-label="Main navigation" {...stylex.props(s.navigation)}>
            {navigation.map(({ name, icon: Icon }) => (
              <button
                type="button"
                key={name}
                onClick={() => navigate(name)}
                aria-current={page === name ? "page" : undefined}
                {...stylex.props(s.navButton, page === name && s.navActive)}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{name}</span>
                {name === "Rewards" && (
                  <span {...stylex.props(s.navCount)}>
                    {orbit.rewards.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div {...stylex.props(s.sidebarBottom)}>
          <div {...stylex.props(s.sidebarNote)}>
            <ShieldCheck size={22} strokeWidth={1.4} />
            <p {...stylex.props(s.sidebarNoteTitle)}>
              Your wallet.
              <br />
              Your little extras.
            </p>
            <p {...stylex.props(s.sidebarNoteBody)}>
              Personal points, powered by Solana.
            </p>
            <button
              type="button"
              onClick={() => navigate("How it works")}
              {...stylex.props(s.sidebarLearn)}
            >
              Meet your membership
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div {...stylex.props(s.network)}>
            <span {...stylex.props(s.networkDot)} />
            Solana Devnet<span {...stylex.props(s.testnet)}>Test network</span>
          </div>
        </div>
      </aside>
      <div {...stylex.props(s.mainColumn)}>
        <header {...stylex.props(s.topbar)}>
          <div {...stylex.props(s.breadcrumb)}>
            Your membership<span {...stylex.props(s.breadcrumbSlash)}>/</span>
            <span {...stylex.props(s.breadcrumbCurrent)}>{page}</span>
          </div>
          <div {...stylex.props(s.walletActions)}>
            {orbit.address ? (
              <>
                <span {...stylex.props(s.walletAddress)}>
                  <span {...stylex.props(s.networkDot)} />
                  {shortWallet(orbit.address)}
                </span>
                {!orbit.connection && (
                  <Button
                    secondary
                    onClick={openWallet}
                    disabled={!!orbit.busy}
                  >
                    Reconnect
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Disconnect wallet"
                  disabled={!!orbit.busy}
                  onClick={() => void orbit.disconnect()}
                  {...stylex.props(s.iconButton)}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <Button secondary onClick={openWallet} disabled={!!orbit.busy}>
                <Wallet size={15} />
                Connect wallet
              </Button>
            )}
          </div>
        </header>
        <main id="main-content" {...stylex.props(s.main)}>
          {orbit.mode === "demo" && (
            <div {...stylex.props(s.demoBanner)}>
              <span>
                <strong>Demo mode</strong> · Sample points and rewards. No
                wallet transactions.
              </span>
              <button
                type="button"
                onClick={orbit.leaveDemo}
                {...stylex.props(s.bannerButton)}
              >
                Exit demo
                <X size={13} />
              </button>
            </div>
          )}
          {orbit.error && (
            <div role="alert" {...stylex.props(s.alert)}>
              <span>{orbit.error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={orbit.clearError}
                {...stylex.props(s.iconButton)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {orbit.notice && (
            <div role="status" {...stylex.props(s.notice)}>
              <span>{orbit.notice}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={orbit.clearNotice}
                {...stylex.props(s.iconButton)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div {...stylex.props(s.pageHeading)}>
            <div>
              <p {...stylex.props(s.welcome)}>
                {orbit.mode === "demo"
                  ? "A peek at your next good thing"
                  : orbit.address
                    ? "Nice to have you back"
                    : "Welcome to your everyday extras"}
              </p>
              <h1 {...stylex.props(s.title)}>
                {page === "Overview"
                  ? "Little things. More rewarding."
                  : page === "Rewards"
                    ? "Find your next good thing."
                    : page === "Activity"
                      ? "Every point has a story."
                      : "Loyalty, with a little more."}
              </h1>
            </div>
            {orbit.mode === "guest" && (
              <button
                type="button"
                onClick={orbit.exploreDemo}
                {...stylex.props(s.demoButton)}
              >
                Explore the demo
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          {page === "Overview" && (
            <>
              <Membership
                data={orbit.data}
                address={orbit.address}
                demo={orbit.mode === "demo"}
                onConnect={openWallet}
                onRewards={() => navigate("Rewards")}
              />
              <SectionHeading
                title="Worth coming back for"
                subtitle="A few little ways to treat yourself."
                action="All rewards"
                onAction={() => navigate("Rewards")}
              />
              <Rewards
                rewards={orbit.rewards}
                points={orbit.data?.points ?? null}
                onSelect={setSelected}
                busy={!!orbit.busy}
              />
              <div {...stylex.props(s.activitySection)}>
                <SectionHeading
                  title="Your latest moments"
                  action="View activity"
                  onAction={() => navigate("Activity")}
                />
                <Activity
                  data={orbit.data}
                  demo={orbit.mode === "demo"}
                  onClaim={showClaim}
                  onResume={(item) => {
                    const reward = orbit.rewards.find(
                      (r) => r.id === item.rewardId,
                    );
                    if (reward) setSelected(reward);
                  }}
                />
              </div>
            </>
          )}
          {page === "Rewards" && (
            <>
              <p {...stylex.props(s.pageDescription)}>
                Turn the points you collect into something you love.
              </p>
              <Rewards
                full
                rewards={orbit.rewards}
                points={orbit.data?.points ?? null}
                onSelect={setSelected}
                busy={!!orbit.busy}
              />
            </>
          )}
          {page === "Activity" && (
            <Activity
              full
              data={orbit.data}
              demo={orbit.mode === "demo"}
              onClaim={showClaim}
              onResume={(item) => {
                const reward = orbit.rewards.find(
                  (r) => r.id === item.rewardId,
                );
                if (reward) setSelected(reward);
              }}
            />
          )}
          {page === "How it works" && <HowItWorks onConnect={openWallet} />}
          <footer {...stylex.props(s.footer)}>
            <span>
              <Leaf size={13} />
              Made for the places you come back to.
            </span>
            <span>Non-transferable. Always yours.</span>
          </footer>
        </main>
      </div>
      {walletDialog && (
        <Dialog
          title="Make yourself at home"
          onClose={() => {
            if (!orbit.busy) setWalletDialog(false);
          }}
        >
          <div {...stylex.props(ui.stack)}>
            <p {...stylex.props(ui.body)}>
              Connect your Solana wallet to see your points. You’ll sign a
              message to log in. Your wallet keeps your keys.
            </p>
            {orbit.config && !orbit.config.configured && (
              <p {...stylex.props(s.setupNote)}>
                Wallet sign-in is available. Earning and redeeming points will
                open once this program’s Devnet mint is configured.
              </p>
            )}
            {wallets.length ? (
              wallets.map((wallet) => (
                <button
                  type="button"
                  key={wallet.name}
                  disabled={!!orbit.busy}
                  onClick={async () => {
                    if (await orbit.connect(wallet)) setWalletDialog(false);
                  }}
                  {...stylex.props(s.walletOption)}
                >
                  <img src={wallet.icon} alt="" width="28" height="28" />
                  {wallet.name}
                  <ArrowUpRight size={17} />
                </button>
              ))
            ) : (
              <p {...stylex.props(s.setupNote)}>
                No compatible wallet detected. Install a Wallet Standard wallet
                such as Phantom or Solflare, enable Devnet, then refresh this
                page.
              </p>
            )}
            {orbit.error && (
              <p role="alert" {...stylex.props(s.dialogError)}>
                {orbit.error}
              </p>
            )}
            {orbit.busy && (
              <p role="status" {...stylex.props(ui.body)}>
                {orbit.busy}…
              </p>
            )}
            <p {...stylex.props(s.finePrint)}>
              Just looking around? The demo works without a wallet.
            </p>
          </div>
          <div {...stylex.props(ui.dialogActions)}>
            <Button
              secondary
              disabled={!!orbit.busy || orbit.mode === "member"}
              onClick={() => {
                orbit.exploreDemo();
                setWalletDialog(false);
              }}
            >
              Explore demo
            </Button>
          </div>
        </Dialog>
      )}
      {selected && (
        <Dialog
          title="A little something for you"
          onClose={() => {
            if (!orbit.busy) setSelected(null);
          }}
        >
          <div {...stylex.props(s.rewardDialogIntro)}>
            <RewardArt id={selected.id} small />
            <div>
              <h3 {...stylex.props(s.rewardDialogTitle)}>{selected.title}</h3>
              <p {...stylex.props(s.rewardDialogCost)}>
                {formatPoints(selected.points)} points
              </p>
            </div>
          </div>
          <p {...stylex.props(ui.body)}>{selected.description}</p>
          <div {...stylex.props(s.redemptionNote)}>
            {orbit.mode === "demo"
              ? "This uses sample points only. The demo reward cannot be collected in store."
              : "Approve in your wallet to spend these points. Redemption is final once confirmed on Solana. A small Devnet SOL network fee applies."}
          </div>
          {orbit.data?.points === null && (
            <p {...stylex.props(s.dialogError)}>
              Your balance is unavailable. Try again once it has refreshed.
            </p>
          )}
          {orbit.data?.points != null && !affordable && (
            <p {...stylex.props(s.dialogError)}>
              You need{" "}
              {formatPoints(
                BigInt(selected.points) - BigInt(orbit.data.points) > 0n
                  ? (
                      BigInt(selected.points) - BigInt(orbit.data.points)
                    ).toString()
                  : "0",
              )}{" "}
              more points.
            </p>
          )}
          {orbit.error && (
            <p role="alert" {...stylex.props(s.dialogError)}>
              {orbit.error}
            </p>
          )}
          {orbit.busy && (
            <p role="status" {...stylex.props(ui.body)}>
              {orbit.busy}…
            </p>
          )}
          <div {...stylex.props(ui.dialogActions)}>
            <Button
              secondary
              disabled={!!orbit.busy}
              onClick={() => setSelected(null)}
            >
              Maybe later
            </Button>
            {ready ? (
              <Button
                disabled={!affordable || !!orbit.busy}
                onClick={async () => {
                  const result = await orbit.redeem(selected);
                  if (result) {
                    setSelected(null);
                    if (result.claimCode) showClaim(result);
                    else navigate("Activity");
                  }
                }}
              >
                {orbit.busy
                  ? "Working…"
                  : `Redeem ${formatPoints(selected.points)} pts`}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setSelected(null);
                  openWallet();
                }}
              >
                Connect wallet
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {claim && (
        <Dialog
          title={
            claim.fulfilledAt ? "Your reward receipt" : "Your reward is ready"
          }
          onClose={() => setClaim(null)}
        >
          <div {...stylex.props(ui.stack)}>
            <h3 {...stylex.props(s.rewardDialogTitle)}>{claim.title}</h3>
            <p {...stylex.props(ui.body)}>
              {orbit.mode === "demo"
                ? "This is a sample reward. Explore the experience; no points moved on Solana."
                : claim.fulfilledAt
                  ? "This reward has already been collected."
                  : "Show this code to the merchant to collect your reward. Each code can be used once."}
            </p>
            <div {...stylex.props(s.claimCode)}>{claim.claimCode}</div>
            {copyError && (
              <p role="alert" {...stylex.props(s.dialogError)}>
                {copyError}
              </p>
            )}
            <Button
              secondary
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(claim.claimCode ?? "");
                  setCopied(true);
                } catch {
                  setCopyError(
                    "Copy is unavailable. Select and copy the code above.",
                  );
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Code copied" : "Copy reward code"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const s = stylex.create({
  app: {
    display: "flex",
    minHeight: "100dvh",
    flexDirection: { default: "row", "@media (max-width: 760px)": "column" },
  },
  sidebar: {
    width: {
      default: 224,
      "@media (max-width: 1100px)": 196,
      "@media (max-width: 760px)": "100%",
    },
    flexShrink: 0,
    backgroundColor: "#fff",
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: "#e7eae0",
    display: "flex",
    flexDirection: "column",
    padding: {
      default: "34px 18px 20px",
      "@media (max-width: 760px)": "18px 16px 10px",
    },
    position: { default: "sticky", "@media (max-width: 760px)": "relative" },
    top: 0,
    height: { default: "100dvh", "@media (max-width: 760px)": "auto" },
  },
  logo: {
    borderWidth: 0,
    backgroundColor: "transparent",
    display: "flex",
    alignItems: "center",
    gap: 9,
    paddingLeft: 13,
    fontSize: 35,
    letterSpacing: "-2px",
    fontWeight: 600,
    color: "#364e37",
    width: "fit-content",
  },
  logoDot: {
    width: 5,
    height: 5,
    backgroundColor: "#9bb867",
    borderRadius: "50%",
    marginLeft: -4,
    marginTop: 19,
  },
  sidebarMiddle: {
    marginTop: { default: 46, "@media (max-width: 760px)": 16 },
  },
  workspaceLabel: {
    paddingLeft: 14,
    fontSize: 10,
    color: "#8a9483",
    marginBottom: 20,
    display: { default: "block", "@media (max-width: 760px)": "none" },
  },
  navigation: {
    display: "flex",
    flexDirection: { default: "column", "@media (max-width: 760px)": "row" },
    gap: 7,
    overflowX: "auto",
  },
  navButton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": "#f4f6ee" },
    borderRadius: 8,
    padding: { default: "13px 14px", "@media (max-width: 760px)": "10px 12px" },
    color: "#7a8374",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  navActive: {
    backgroundColor: { default: "#edf2e3", ":hover": "#e7eedc" },
    color: "#405a42",
    fontWeight: 600,
  },
  navCount: {
    marginLeft: "auto",
    fontSize: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e4e9de",
    borderRadius: 5,
    padding: "1px 5px",
    display: { default: "block", "@media (max-width: 760px)": "none" },
  },
  sidebarBottom: {
    marginTop: "auto",
    display: { default: "block", "@media (max-width: 760px)": "none" },
  },
  sidebarNote: {
    backgroundColor: "#f6f7f2",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#e6eadf",
    borderRadius: 10,
    padding: 17,
    color: "#607253",
    marginBottom: 27,
  },
  sidebarNoteTitle: {
    fontSize: 15,
    lineHeight: 1.4,
    marginTop: 10,
    fontWeight: 500,
    letterSpacing: "-.3px",
  },
  sidebarNoteBody: {
    fontSize: 10,
    lineHeight: 1.65,
    marginTop: 8,
    color: "#7e8974",
  },
  sidebarLearn: {
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 10,
    color: "#405a42",
    marginTop: 15,
  },
  network: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 9,
    color: "#6c7862",
  },
  networkDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    backgroundColor: "#889d60",
    flexShrink: 0,
  },
  testnet: {
    marginLeft: "auto",
    fontSize: 8,
    backgroundColor: "#f1f3eb",
    padding: "3px 4px",
    borderRadius: 4,
  },
  mainColumn: { flexGrow: 1, minWidth: 0 },
  topbar: {
    height: 83,
    paddingInline: {
      default: 42,
      "@media (max-width: 1100px)": 27,
      "@media (max-width: 760px)": 20,
    },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "#e6eade",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 15,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    fontSize: 11,
    color: "#87917e",
  },
  breadcrumbSlash: {
    color: "#bdc5b4",
    display: { default: "inline", "@media (max-width: 540px)": "none" },
  },
  breadcrumbCurrent: {
    color: "#55644b",
    display: { default: "inline", "@media (max-width: 540px)": "none" },
  },
  walletActions: { display: "flex", alignItems: "center", gap: 12 },
  walletAddress: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12,
  },
  iconButton: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 5,
    padding: 5,
    display: "inline-flex",
    alignItems: "center",
    color: "#76816c",
  },
  main: {
    maxWidth: 1280,
    marginInline: "auto",
    padding: {
      default: "36px 42px 20px",
      "@media (max-width: 1100px)": "30px 27px 20px",
      "@media (max-width: 760px)": "26px 20px 20px",
    },
  },
  pageHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 30,
    flexWrap: "wrap",
  },
  welcome: { fontSize: 12, color: "#7d8873", marginBottom: 8 },
  title: {
    fontSize: { default: 31, "@media (max-width: 540px)": 27 },
    fontWeight: 500,
    letterSpacing: "-1.3px",
    lineHeight: 1.2,
  },
  demoButton: {
    display: "inline-flex",
    gap: 6,
    alignItems: "center",
    borderWidth: 0,
    padding: "5px 0",
    backgroundColor: "transparent",
    fontSize: 11,
    color: "#5c704b",
  },
  activitySection: { marginTop: 36 },
  pageDescription: { color: "#737c71", fontSize: 14, marginBottom: 25 },
  demoBanner: {
    backgroundColor: "#edf0e3",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dce2ce",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 11,
    color: "#526447",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    marginBottom: 24,
  },
  bannerButton: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  alert: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fbede8",
    color: "#934a32",
    padding: "13px 15px",
    borderRadius: 8,
    fontSize: 12,
    marginBottom: 22,
    lineHeight: 1.5,
  },
  notice: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#e9f2df",
    color: "#4c6a39",
    padding: "13px 15px",
    borderRadius: 8,
    fontSize: 12,
    marginBottom: 22,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 28,
    paddingTop: 15,
    fontSize: 10,
    color: "#8a9480",
    flexWrap: "wrap",
    alignItems: "center",
  },
  walletOption: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#dce2d5",
    borderRadius: 10,
    backgroundColor: "#f7f9f3",
    fontSize: 14,
    fontWeight: 500,
  },
  setupNote: {
    backgroundColor: "#f4f5ef",
    padding: 15,
    borderRadius: 9,
    fontSize: 12,
    lineHeight: 1.7,
    color: "#66725c",
  },
  finePrint: { fontSize: 11, color: "#7d8873", lineHeight: 1.6 },
  dialogError: {
    color: "#9a482f",
    fontSize: 12,
    marginTop: 12,
    lineHeight: 1.6,
  },
  rewardDialogIntro: {
    display: "flex",
    gap: 17,
    alignItems: "center",
    marginBottom: 20,
  },
  rewardDialogTitle: { fontSize: 18, fontWeight: 550, letterSpacing: "-.4px" },
  rewardDialogCost: { color: "#68795b", fontSize: 13, marginTop: 5 },
  redemptionNote: {
    backgroundColor: "#f2f5eb",
    borderRadius: 8,
    padding: 14,
    fontSize: 12,
    lineHeight: 1.65,
    color: "#68775b",
    marginTop: 20,
  },
  claimCode: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#9daa8c",
    borderRadius: 9,
    padding: 20,
    textAlign: "center",
    fontSize: 16,
    backgroundColor: "#f5f8ef",
    overflowWrap: "anywhere",
    userSelect: "all",
  },
});
