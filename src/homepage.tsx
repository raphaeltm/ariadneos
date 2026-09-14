import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Hash,
  MessageSquare,
  Waypoints,
} from "lucide-react";
import "./marketing.css";

const steps = [
  {
    icon: MessageSquare,
    text: "Requests, decisions, and handoffs already happen in Slack. That’s where our integration starts.",
    title: "Start with the conversation",
  },
  {
    icon: GitBranch,
    text: "Bring those moments into a process view. See the common route, the detours, and where work waits.",
    title: "Find the path through it",
  },
  {
    icon: Waypoints,
    text: "Help people and agents understand how work moves, with observations behind the bigger picture.",
    title: "Give the next step context",
  },
];

export default function Homepage() {
  return (
    <div className="marketing">
      <a className="marketing-skip" href="#main">
        Skip to content
      </a>
      <header className="marketing-nav">
        <a aria-label="AriadneOS home" className="marketing-brand" href="/">
          <span className="marketing-mark">
            A<span />
          </span>
          Ariadne<span className="marketing-os">OS</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="marketing-section-link" href="/how-it-works">
            How it works
          </a>
          <a className="marketing-section-link" href="#why-slack">
            Why Slack
          </a>
          <a className="marketing-open" href="/app">
            Open app <ArrowUpRight size={16} />
          </a>
        </nav>
      </header>
      <main id="main">
        <section aria-labelledby="hero-title" className="marketing-hero">
          <div className="marketing-hero-copy">
            <span className="marketing-kicker">
              <span /> PROCESS INTELLIGENCE, STARTING IN SLACK
            </span>
            <h1 id="hero-title">
              Every conversation.
              <br />A thread to the
              <br />
              <em>bigger picture.</em>
            </h1>
            <p>
              Work happens in Slack. AriadneOS turns its requests, decisions and
              handoffs into a living map of how your team actually gets things
              done, with every step linked back to the message that proves it.
            </p>
            <div className="marketing-actions">
              <a className="marketing-button" href="/app">
                Connect your Slack <ArrowRight size={18} />
              </a>
              <a className="marketing-text-link" href="/how-it-works">
                See how it works <span>↗</span>
              </a>
            </div>
            <span className="marketing-setup-note">
              Sign in with Slack · Add the bot to one channel · Name your
              process
            </span>
          </div>
          <figure
            aria-label="Illustrative example of a Slack conversation becoming a process map"
            className="marketing-preview"
          >
            <div className="marketing-preview-label">
              <span className="marketing-kicker">FROM THE THREAD</span>
              <span>Illustrative example</span>
            </div>
            <div className="marketing-thread">
              <div className="marketing-channel">
                <Hash size={19} />
                <strong>vendor-requests</strong>
                <span>Slack</span>
              </div>
              <div className="marketing-message">
                <span className="marketing-avatar peach">JL</span>
                <div>
                  <strong>
                    Jamie Lee <time>9:04 AM</time>
                  </strong>
                  <p>
                    We need a new design tool. Can someone review the vendor?
                  </p>
                  <span className="marketing-reply">
                    3 replies · A process taking shape
                  </span>
                </div>
              </div>
              <div className="marketing-message marketing-thread-reply">
                <span className="marketing-avatar lavender">MK</span>
                <div>
                  <strong>
                    Morgan Kim <time>9:18 AM</time>
                  </strong>
                  <p>Security review is done. Over to finance for approval.</p>
                  <span className="marketing-reaction">
                    <Check size={12} /> 1
                  </span>
                </div>
              </div>
            </div>
            <div className="marketing-thread-connector">
              <span />
              <span className="marketing-transform">
                <Waypoints size={17} /> AriadneOS connects the steps
              </span>
              <span />
            </div>
            <div className="marketing-map">
              <div className="marketing-map-heading">
                <div>
                  <span className="marketing-kicker">TO THE PROCESS</span>
                  <h2>Vendor approval</h2>
                </div>
                <GitBranch size={20} />
              </div>
              <div className="marketing-flow">
                <div>
                  <span>
                    <MessageSquare size={17} />
                  </span>
                  <strong>Request</strong>
                </div>
                <i />
                <div>
                  <span>
                    <Check size={17} />
                  </span>
                  <strong>Review</strong>
                </div>
                <i />
                <div>
                  <span>
                    <ArrowRight size={17} />
                  </span>
                  <strong>Approval</strong>
                </div>
              </div>
              <div className="marketing-map-caption">
                <span className="marketing-small-dot" /> See the handoff.
                Understand the path.
              </div>
            </div>
            <div className="marketing-preview-foot">
              The work is already there. Follow its thread.
            </div>
          </figure>
        </section>
        <section className="marketing-principle" id="why-slack">
          <span className="marketing-kicker">
            ONE INTEGRATION. A CLEARER PICTURE.
          </span>
          <p>
            Your team’s process isn’t in a flowchart.
            <br />
            It’s in <span>“can you review this?”</span>
          </p>
          <div>
            We’re focused on Slack: the conversations where work gets requested,
            ownership changes, and decisions move things forward.
          </div>
        </section>
        <section
          aria-labelledby="how-title"
          className="marketing-how"
          id="how-it-works"
        >
          <div className="marketing-section-heading">
            <span className="marketing-kicker">FOLLOW THE WORK</span>
            <h2 id="how-title">
              From scattered messages
              <br />
              to shared understanding.
            </h2>
            <p>
              A Slack-first approach to making the invisible parts of work
              easier to see.
            </p>
          </div>
          <div className="marketing-steps">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <article key={title}>
                <div className="marketing-step-top">
                  <Icon size={24} />
                  <span className="marketing-step-number">0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="marketing-cta">
          <div>
            <span className="marketing-kicker">
              A LITTLE WORK. A BIGGER PICTURE.
            </span>
            <h2>See your process come to life.</h2>
            <p>
              Connect one Slack channel and name the steps your process is meant
              to follow. Ariadne maps what your team actually did, shows where
              it diverged, and links every step to its source message.
            </p>
          </div>
          <a className="marketing-button" href="/app">
            Connect your Slack <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer className="marketing-footer">
        <a className="marketing-brand" href="/">
          Ariadne<span className="marketing-os">OS</span>
        </a>
        <span>Follow the work. Find the thread.</span>
        <a href="/app">
          Open app <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
