import "./LicenseNote.css";

const REPO_URL = "https://github.com/openalice-org/openalice.org";

export default function LicenseNote() {
  return (
    <div className="license-note">
      MIT License ·{" "}
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
        Source
      </a>
    </div>
  );
}
