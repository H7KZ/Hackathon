import { PromptForm } from "../components/PromptForm";
import { PromptHelp } from "../components/PromptHelp";
import "./landing.css";

export default function HomePage() {
  return (
    <div className="landing">
      <header className="brand">
        {/* a full reload on purpose: it resets the form */}
        <a href="/" title="Začít znovu">
          <img src="/fis-logo.png" alt="Fakulta informatiky a statistiky VŠE" />
          <h1>JOJO</h1>
        </a>
      </header>
      <p className="lead">Z vašeho příběhu vytvoříme data, ve kterých se dá dohledat.</p>
      <PromptForm />
      <PromptHelp />
    </div>
  );
}
