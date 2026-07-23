import { useNavigate } from "react-router-dom";
import { IconDownload } from "../ui/Icons";

// Public front door. Most visitors come to get the extension, not to sign in,
// so this page leads with the download; configuration sign-in lives at /login.
export function Download() {
  const navigate = useNavigate();
  return (
    <div className="download-page">
      <div className="download-card">
        <img className="download-logo" src="/favicon.png" alt="" />
        <h1 className="download-title">CAST</h1>
        <p className="download-tagline">ConnectWise Augmentation Suite for Triton</p>
        <p className="download-desc">
          The CAST browser extension standardizes ConnectWise for your role — hiding clutter and surfacing what matters,
          automatically.
        </p>
        <a className="btn btn-primary btn-lg download-cta" href="/api/extension/install.bat" download>
          <IconDownload width={18} height={18} />
          Download the CAST Browser Extension
        </a>
        <p className="download-for">For Chrome and Edge browsers</p>
        <ol className="download-steps">
          <li>
            <span className="step-num">1</span>
            <span>Download and run the installer.</span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>If prompted, click to approve.</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>Restart your browser.</span>
          </li>
        </ol>
      </div>
      <button type="button" className="btn download-signin" onClick={() => navigate("/login")}>
        Configuration sign-in →
      </button>
    </div>
  );
}
