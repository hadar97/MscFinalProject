import Logo from "./Logo";

// Top bar of the questionnaire: logo + "Step n of 2"
export default function OnboardingHeader({ step }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-6 px-6 py-5 md:px-12">
      <Logo href="/for-you" />
      <div className="flex items-center gap-3 text-sm text-muted">
        <span>Step {step} of 2</span>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={2} aria-valuenow={step} aria-label="Questionnaire progress">
          <div className="h-full bg-rust" style={{ width: `${step * 50}%` }} />
        </div>
      </div>
    </header>
  );
}
