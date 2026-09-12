import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Hash,
  MessageSquare,
  ScanText,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import "./marketing.css";
import "./how-it-works.css";

function ProcessDiagram() {
  const [compare, setCompare] = useState(false);
  return (
    <figure className="how-diagram how-process">
      <div className="how-figure-top">
        <span className="marketing-kicker">THE SAME WORK, TWO VIEWS</span>
        <span>Illustrative example</span>
      </div>
      <fieldset aria-label="Process map view" className="how-toggle">
        <button
          aria-pressed={!compare}
          onClick={() => setCompare(false)}
          type="button"
        >
          Observed path
        </button>
        <button
          aria-pressed={compare}
          onClick={() => setCompare(true)}
          type="button"
        >
          Compare with expected
        </button>
      </fieldset>
      <div
        aria-label={
          compare
            ? "Expected: request, security review, approval. Observed: request directly to approval; review was not observed."
            : "Observed: request directly to approval. Security review was not observed."
        }
        className={`how-map ${compare ? "how-map-compare" : ""}`}
        role="img"
      >
        <svg
          aria-hidden="true"
          className="how-map-lines"
          preserveAspectRatio="none"
          viewBox="0 0 600 220"
        >
          <path className="how-expected-line" d="M100 70 H500" />
          <path
            className="how-observed-line"
            d="M100 70 C100 205 500 205 500 70"
          />
          <circle cx="100" cy="70" r="5" />
          <circle cx="500" cy="70" r="5" />
        </svg>
        <div className="how-map-node">
          <MessageSquare size={20} />
          <strong>Request</strong>
          <span>Observed</span>
        </div>
        <div className="how-map-node how-missing">
          <ScanText size={20} />
          <strong>Security review</strong>
          <span>{compare ? "Expected · not observed" : "Not observed"}</span>
        </div>
        <div className="how-map-node">
          <Check size={20} />
          <strong>Approval</strong>
          <span>Observed</span>
        </div>
        <span className="how-route-label">
          The path seen in the conversation
        </span>
      </div>
      <figcaption aria-live="polite">
        {compare
          ? "A gap is a reason to look closer. A missing observation does not prove the review never happened."
          : "The map follows the evidence available in Slack. Switch views to see how this path compares with the expected workflow."}
      </figcaption>
    </figure>
  );
}

export default function HowItWorks() {
  return (
    <div className="marketing how-page">
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
          <a
            aria-current="page"
            className="marketing-section-link"
            href="/how-it-works"
          >
            How it works
          </a>
          <a className="marketing-open" href="/app">
            Open app <ArrowUpRight size={16} />
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section
          aria-labelledby="how-hero-title"
          className="how-hero how-container"
        >
          <span className="marketing-kicker">
            <span /> A LITTLE CURIOSITY. A CLEARER PICTURE.
          </span>
          <h1 id="how-hero-title">
            There’s a process
            <br />
            inside the <em>conversation.</em>
          </h1>
          <p>
            AriadneOS connects the moments in Slack to reveal how work moves.
            Here’s how a thread becomes a map you can explore, question, and
            understand.
          </p>
          <a className="how-jump" href="#follow-the-thread">
            Follow the thread <ArrowDown size={16} />
          </a>
          <figure className="how-overview">
            <div aria-hidden="true" className="how-orbit">
              <svg
                aria-hidden="true"
                preserveAspectRatio="none"
                viewBox="0 0 1100 260"
              >
                <path d="M-30 200 C130 -100 270 360 440 110 S750 0 850 130 S1060 250 1130 40" />
                <path d="M-30 220 C130 -80 270 380 440 130 S750 20 850 150 S1060 270 1130 60" />
              </svg>
            </div>
            <ol className="how-stations">
              {[
                {
                  icon: Hash,
                  text: "The work as it happens",
                  title: "Conversations",
                },
                {
                  icon: ScanText,
                  text: "The signals in the thread",
                  title: "Meaningful steps",
                },
                {
                  icon: GitBranch,
                  text: "The paths work takes",
                  title: "A process map",
                },
                {
                  icon: Waypoints,
                  text: "The context to improve it",
                  title: "Shared understanding",
                },
              ].map(({ icon: Icon, title, text }, index) => (
                <li key={title}>
                  <span className="how-station-icon">
                    <Icon size={26} />
                  </span>
                  <span className="how-station-number">0{index + 1}</span>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <figcaption>
              Slack messages → evidence-backed steps → connected paths → a
              clearer picture
            </figcaption>
          </figure>
        </section>
        <div className="how-story how-container" id="follow-the-thread">
          <section aria-labelledby="how-listen-title" className="how-chapter">
            <div className="how-chapter-copy">
              <span className="how-number">01 / FIND THE SIGNAL</span>
              <h2 id="how-listen-title">
                Start with what
                <br />
                people actually say.
              </h2>
              <p>
                A request. A promise to review. A decision that moves work
                forward. AriadneOS looks for these moments in Slack
                conversations and turns them into recognizable steps.
              </p>
              <p>
                AI helps interpret the language, while evidence checks keep each
                step tied to the messages behind it. “I’ll review it” and “I
                reviewed it” mean different things.
              </p>
              <div className="how-takeaway">
                <ScanText size={18} />
                <span>A promise is not a completed step.</span>
              </div>
            </div>
            <figure className="how-diagram how-extraction">
              <div className="how-figure-top">
                <span className="marketing-kicker">FROM WORDS TO WORK</span>
                <span>Illustrative example</span>
              </div>
              <div className="how-slack-heading">
                <Hash size={18} />
                <strong>vendor-requests</strong>
                <span>Slack</span>
              </div>
              <div className="how-message">
                <span className="marketing-avatar peach">JL</span>
                <div>
                  <strong>
                    Jamie <span>9:04</span>
                  </strong>
                  <p>Can someone review this vendor?</p>
                </div>
              </div>
              <div className="how-message">
                <span className="marketing-avatar lavender">MK</span>
                <div>
                  <strong>
                    Morgan <span>9:08</span>
                  </strong>
                  <p>I’ll take the security review.</p>
                </div>
              </div>
              <div className="how-message">
                <span className="marketing-avatar lavender">MK</span>
                <div>
                  <strong>
                    Morgan <span>9:18</span>
                  </strong>
                  <p>Security review is done. Looks good.</p>
                </div>
              </div>
              <div aria-hidden="true" className="how-extract-arrow">
                <ArrowDown size={22} />
                <span>Interpret · link to evidence</span>
              </div>
              <div className="how-step-card">
                <span className="how-step-icon">
                  <Check size={20} />
                </span>
                <div>
                  <strong>Security review</strong>
                  <span>Reported complete · Morgan</span>
                </div>
                <span className="how-evidence-tag">9:18 message</span>
              </div>
              <figcaption>
                The extracted step keeps a reference to its source, so the
                interpretation can be checked.
              </figcaption>
            </figure>
          </section>
          <section
            aria-labelledby="how-connect-title"
            className="how-chapter how-chapter-reverse"
          >
            <div className="how-chapter-copy">
              <span className="how-number">02 / CONNECT THE MOMENTS</span>
              <h2 id="how-connect-title">
                One thread is a story.
                <br />
                Many reveal a pattern.
              </h2>
              <p>
                Within a piece of work, steps form a sequence. Across similar
                pieces of work, those sequences reveal the common route,
                alternative paths, and repeated steps.
              </p>
              <p>
                The map brings those paths together. Each connection shows how
                one observed step follows another, so you can move from the big
                picture back to the evidence.
              </p>
              <div className="how-takeaway">
                <GitBranch size={18} />
                <span>A map built from observations, not guesswork alone.</span>
              </div>
            </div>
            <figure className="how-diagram how-weave">
              <div className="how-figure-top">
                <span className="marketing-kicker">
                  SEPARATE STORIES. SHARED STEPS.
                </span>
                <span>Illustrative example</span>
              </div>
              <div className="how-case">
                <span>Thread A</span>
                <span>Request</span>
                <ArrowRight />
                <span>Review</span>
                <ArrowRight />
                <span>Approval</span>
              </div>
              <div className="how-case">
                <span>Thread B</span>
                <span>Request</span>
                <ArrowRight />
                <span>Review</span>
                <ArrowRight />
                <span>Approval</span>
              </div>
              <div className="how-case how-case-detour">
                <span>Thread C</span>
                <span>Request</span>
                <ArrowRight />
                <span>Clarify</span>
                <ArrowRight />
                <span>Review</span>
              </div>
              <div aria-hidden="true" className="how-weave-lines">
                <svg
                  aria-hidden="true"
                  preserveAspectRatio="none"
                  viewBox="0 0 500 100"
                >
                  <path d="M70 0 C70 60 250 40 250 100 M250 0 V100 M430 0 C430 60 250 40 250 100" />
                </svg>
              </div>
              <div className="how-pattern">
                <Waypoints size={30} />
                <div>
                  <strong>Vendor approval</strong>
                  <span>A common route, with a clarification detour</span>
                </div>
                <span className="how-pattern-count">3 threads</span>
              </div>
              <figcaption>
                Similar activities come together; the differences stay visible.
                Repeated steps can reveal where work loops back.
              </figcaption>
            </figure>
          </section>
          <section aria-labelledby="how-compare-title" className="how-chapter">
            <div className="how-chapter-copy">
              <span className="how-number">
                03 / SEE WHAT NEEDS A CLOSER LOOK
              </span>
              <h2 id="how-compare-title">
                Compare the plan
                <br />
                with the path.
              </h2>
              <p>
                An expected workflow describes how work should move. The
                observed map describes what the available conversations show.
                AriadneOS can compare the two.
              </p>
              <p>
                Missing steps, unexpected detours, and changes in order become
                starting points for a question. You bring the context; the
                evidence helps you investigate.
              </p>
              <div className="how-takeaway">
                <Waypoints size={18} />
                <span>Try the two views in the diagram.</span>
              </div>
            </div>
            <ProcessDiagram />
          </section>
        </div>
        <section aria-labelledby="how-trust-title" className="how-trust">
          <div className="how-container">
            <span className="marketing-kicker">
              A MAP, WITH ITS SOURCES ATTACHED
            </span>
            <h2 id="how-trust-title">
              The bigger picture.
              <br />
              <em>Without losing the thread.</em>
            </h2>
            <div className="how-principles">
              <article>
                <span>01</span>
                <h3>Evidence stays close</h3>
                <p>
                  Inspect the messages behind a step, rather than relying on a
                  summary alone.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>Uncertainty stays visible</h3>
                <p>
                  A proposed interpretation is different from a confirmed
                  observation. Missing evidence is not proof of missing work.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>People add context</h3>
                <p>
                  Review interpretations and refine the process model as your
                  understanding of the work grows.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section className="marketing-cta how-cta">
          <div>
            <span className="marketing-kicker">
              NOW FOLLOW A THREAD OF YOUR OWN
            </span>
            <h2>Meet the map.</h2>
            <p>
              Open the app to explore the process experience. The diagrams on
              this page are illustrative, not a live view of a Slack workspace.
            </p>
          </div>
          <a className="marketing-button" href="/app">
            Open AriadneOS <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer className="marketing-footer">
        <a className="marketing-brand" href="/">
          Ariadne<span className="marketing-os">OS</span>
        </a>
        <span>Follow the work. Find the thread.</span>
        <a href="/">
          Back to home <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
