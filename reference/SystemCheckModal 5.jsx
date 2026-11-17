import { useState, useEffect, useRef } from "react";
import {
  downloadSystemCheckExe,
  downloadSystemCheckBat,
  checkSystemCheckStatus,
} from "../utils/api";
import "./SystemCheckModal.css";

const SystemCheckModal = ({ interviewId, onPass, onClose }) => {
  const [status, setStatus] = useState("idle"); // "idle" | "downloaded" | "checking" | "passed" | "failed" | "timeout"
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pollingMessage, setPollingMessage] = useState("");
  const pollingIntervalRef = useRef(null);
  const pollCountRef = useRef(0);

  // Download both the system check executable and the bat file
  const downloadSystemCheckFiles = async () => {
    try {
      setError(null);

      if (!interviewId) {
        throw new Error("Interview ID is missing");
      }

      let exeBlob = null;
      let batBlob = null;
      let exeError = null;
      let batError = null;

      // Download exe file
      try {
        exeBlob = await downloadSystemCheckExe();
      } catch (err) {
        console.error("Failed to download exe:", err);
        exeError = err;
      }

      // Download bat file
      try {
        batBlob = await downloadSystemCheckBat(interviewId);
      } catch (err) {
        console.error("Failed to download bat:", err);
        batError = err;
      }

      // If both downloads failed, throw error
      if (exeError && batError) {
        throw new Error("Failed to download both files. Please try again.");
      }

      // Download exe file if available
      if (exeBlob) {
        const exeUrl = window.URL.createObjectURL(exeBlob);
        const exeLink = document.createElement("a");
        exeLink.href = exeUrl;
        exeLink.download = "system_check.exe";
        document.body.appendChild(exeLink);
        exeLink.click();
        document.body.removeChild(exeLink);
        window.URL.revokeObjectURL(exeUrl);
      }

      // Download bat file if available (with a small delay to avoid browser blocking multiple downloads)
      if (batBlob) {
        setTimeout(() => {
          const batUrl = window.URL.createObjectURL(batBlob);
          const batLink = document.createElement("a");
          batLink.href = batUrl;
          batLink.download = `run_${interviewId}.bat`;
          document.body.appendChild(batLink);
          batLink.click();
          document.body.removeChild(batLink);
          window.URL.revokeObjectURL(batUrl);
        }, 300);
      }

      // If either file was downloaded successfully, proceed
      if (exeBlob || batBlob) {
        setStatus("downloaded");
        startPolling(interviewId);
      } else {
        throw new Error("No files were downloaded. Please try again.");
      }
    } catch (err) {
      console.error("Download failed:", err);
      setError(err.message);
    }
  };

  // Poll the backend for system check results
  const checkStatus = async (id) => {
    try {
      const data = await checkSystemCheckStatus(id);

      if (!data) {
        return false; // Continue polling
      }

      // If results are found
      if (data.found && data.result) {
        setResult(data.result);

        const resultStatus = data.result.status || data.status;
        if (resultStatus === "PASS") {
          setStatus("passed");
          return true; // Stop polling
        } else if (resultStatus === "FAIL") {
          setStatus("checking"); // keep polling UI active
          setResult(data.result); // store reasons
          setPollingMessage("Issues detected. Please fix them and run the .bat file again.");
          return false; // stop polling, but keep UI same
        }
      }

      return false; // Continue polling
    } catch (err) {
      console.error("Status check error:", err);
      return false;
    }
  };

  // Start polling for results
  const startPolling = (id) => {
    pollCountRef.current = 0;
    const maxPolls = 120; // Poll for up to 2 minutes (120 * 1 second)

    setStatus("checking");
    setPollingMessage(
      "Waiting for system check to complete. Please ensure the .bat file is running..."
    );

    pollingIntervalRef.current = setInterval(async () => {
      pollCountRef.current++;

      // Update message based on polling attempts
      if (pollCountRef.current % 10 === 0) {
        setPollingMessage(
          `Still waiting... (${pollCountRef.current}s elapsed) Please ensure you have run the .bat file.`
        );
      }

      const shouldStop = await checkStatus(id);

      if (shouldStop || pollCountRef.current >= maxPolls) {
        clearInterval(pollingIntervalRef.current);

        if (pollCountRef.current >= maxPolls) {
          setStatus("timeout");
          setPollingMessage("");
        }
      }
    }, 1000); // Poll every 1 second
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Listen for status changes and auto-proceed on pass
  useEffect(() => {
    if (status === "passed") {
      setTimeout(() => onPass(), 1500);
    }
  }, [status, onPass]);

  const getFailureReasons = () => {
    if (!result) return ["Unknown error"];

    const reasons = [];

    if (result.reasons && Array.isArray(result.reasons)) {
      return result.reasons;
    }

    // Fallback: construct reasons from result fields
    if (result.multiple_monitors) reasons.push("Multiple monitors detected");
    if (result.multiple_keyboards) reasons.push("Multiple keyboards detected");
    if (result.multiple_mice) reasons.push("Multiple mouse detected");
    if (result.virtual_machine)
      reasons.push("Running inside a virtual machine");
    if (result.is_rdp) reasons.push("Connected via Remote Desktop (RDP)");
    if (result.remote_access_tools?.length > 0)
      reasons.push(
        `Remote access tools detected: ${result.remote_access_tools.join(", ")}`
      );

    return reasons.length ? reasons : ["Unknown security policy violation"];
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 tt-system-check-overlay ${status === "idle" ? "is-idle" : ""}`}>
      <div className={`bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-[840px] w-full mx-4 p-6 relative tt-system-check-modal ${status === "idle" ? "is-idle" : status === "checking" ? (result ? "is-issues" : "is-checking") : `is-${status}`}`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-red-600 text-2xl font-bold tt-check-close"
          aria-label="Close"
        >
          &times;
        </button>

        {status === "idle" && (
          <div className="tt-check-art" aria-hidden="true">
            <span className="tt-check-art-glow" />
            <svg viewBox="0 0 230 230" fill="none">
              <circle cx="115" cy="115" r="96" fill="#F7F3FF" />
              <g className="tt-check-art-ring"><circle cx="115" cy="115" r="78" stroke="#B9A2EE" strokeWidth="1.6" strokeDasharray="4 7" /><circle cx="185" cy="82" r="9" fill="#B38BFA" /><circle cx="40" cy="132" r="7" fill="#D9C9F7" /></g>
              <g className="tt-check-art-ring2"><circle cx="115" cy="115" r="96" stroke="#E2D6FA" strokeWidth="1.2" strokeDasharray="2 10" /><circle cx="196" cy="140" r="11" fill="#A66FFF" opacity=".8" /><circle cx="148" cy="22" r="7" fill="#D9C9F7" /></g>
              <circle cx="115" cy="115" r="52" fill="#EDE5FD" />
              <g className="tt-check-art-shield"><path d="M115 76l30 11v22c0 20-13 34-30 41-17-7-30-21-30-41V87l30-11Z" fill="#fff" stroke="#4B1498" strokeWidth="5" strokeLinejoin="round" /><path className="tt-check-art-tick" d="M101 113l10 10 19-20" stroke="#4B1498" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></g>
            </svg>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-6 tt-check-header">
          <span className="tt-check-lock" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10H7Zm2 0h6V7.5a3 3 0 0 0-6 0V10Zm3 4a1.6 1.6 0 0 0-.9 2.9V18.5a.9.9 0 0 0 1.8 0v-1.6A1.6 1.6 0 0 0 12 14Z" /></svg></span>
          <div className="tt-check-copy">
            <h2 className="text-2xl font-extrabold text-gray-800 dark:text-white"><span className="tt-check-title">System Security <span className="tt-check-title-accent">Check</span></span></h2>
            <p className="text-gray-600 dark:text-gray-300 mt-2">
              To ensure interview integrity, we'll verify your system setup.
            </p>
          </div>
        </div>

        {/* Instructions - Initial State */}
        {status === "idle" && (
          <div className="space-y-4 mb-6 tt-check-instructions">
            <div className="bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 p-4 rounded tt-check-panel tt-check-requirements">
              <p className="text-blue-800 dark:text-blue-200 font-medium mb-3">
                <span className="tt-check-heading-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8l-5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span className="tt-check-section-title">System Requirements:</span>
              </p>
              <ul className="list-disc pl-5 text-blue-700 dark:text-blue-300 space-y-1 text-sm tt-check-requirements-list">
                <li>No external monitors or virtual machines</li>
                <li>No extra keyboards/mice connected</li>
                <li>No remote desktop (RDP/TeamViewer/AnyDesk) running</li>
                <li>You are using a physical, personal device</li>
              </ul>
            </div>

            <div className="bg-orange-50 dark:bg-orange-950/40 border-l-4 border-orange-600 p-4 rounded tt-check-panel tt-check-warning">
              <p className="text-orange-900 dark:text-orange-200 font-bold mb-2 flex items-center gap-2">
                <span className="tt-check-heading-icon warning" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="#F59E0B"/><path d="M12 9v5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></svg></span><span className="tt-check-section-title">Important Instructions</span>
              </p>
              <p className="text-orange-800 dark:text-orange-100 text-sm leading-relaxed">
                After downloading the <code className="bg-white dark:bg-gray-950 px-2 py-1 rounded text-xs font-mono text-gray-900 dark:text-gray-100">.exe</code> and the <code className="bg-white dark:bg-gray-950 px-2 py-1 rounded text-xs font-mono text-gray-900 dark:text-gray-100">.bat</code> file, please <b>run ONLY the .bat file</b> from your system. Do not run the .exe file directly. The .bat file will automatically run the system check.
              </p>
            </div>
          </div>
        )}

        {/* Download Button - Initial State */}
        {status === "idle" && (
          <div className="text-center tt-check-download-wrap">
            <button
              onClick={downloadSystemCheckFiles}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg shadow transition flex items-center justify-center gap-2 mx-auto tt-check-download"
            >
              <svg className="tt-check-download-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v3h16v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="tt-check-download-label">Download System Check Files</span>
            </button>
          </div>
        )}

        {/* Downloaded - Instructions */}
        {status === "downloaded" && (
          <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-4 mb-4 rounded tt-check-panel tt-check-downloaded">
            <p className="text-green-800 dark:text-green-200 font-semibold mb-3">
              ✅ Files Downloaded Successfully!
            </p>
            <p className="text-green-700 dark:text-green-300 text-sm mb-3">
              Now please follow these steps:
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-green-700 dark:text-green-300 text-sm font-medium">
              <li>
                Locate both downloaded files in your Downloads folder:{" "}
                <code className="bg-white dark:bg-gray-800 px-2 py-1 rounded text-xs">
                  system_check.exe
                </code>{" "}
                and{" "}
                <code className="bg-white dark:bg-gray-800 px-2 py-1 rounded text-xs">
                  run_*.bat
                </code>
              </li>
              <li>
                Run the{" "}
                <code className="bg-white dark:bg-gray-800 px-2 py-1 rounded text-xs">
                  run_*.bat
                </code>{" "}
                file first (this will run the system check)
              </li>
              <li>
                The batch file will execute system_check.exe and report results
              </li>
              <li>
                The results will appear below automatically once the check
                finishes
              </li>
            </ol>
          </div>
        )}

        {/* Checking - Polling State */}
        {status === "checking" && (
          <div className="text-center py-6 tt-check-progress">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-teal-600 mb-4 tt-check-spinner" aria-hidden="true">
              <svg viewBox="0 0 84 84" fill="none"><defs><linearGradient id="ttCheckGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#C4A6FF"/><stop offset="1" stopColor="#4B1498"/></linearGradient></defs><circle cx="42" cy="42" r="34" stroke="#EEE8FC" strokeWidth="6"/><path d="M42 8a34 34 0 0 1 29.4 51" stroke="url(#ttCheckGrad)" strokeWidth="6" strokeLinecap="round"/></svg>
            </div>
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
              Checking for system check results...
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              {pollingMessage}
            </p>
            <div className="tt-check-bar" aria-hidden="true"><span /></div>
            {/* Show failure issues WHILE still in checking state */}
            {result && (
              <div className="mt-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded text-left max-w-md mx-auto tt-check-issues">
                <p className="text-red-700 dark:text-red-300 font-semibold">
                  Issues Detected:
                </p>

                <ul className="list-disc pl-5 text-red-700 dark:text-red-300 text-sm mt-2 space-y-1 tt-check-issues-list">
                  {getFailureReasons().map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>

                <p className="text-gray-700 dark:text-gray-300 text-sm mt-3">
                  Please fix the above issues and <b>run the .bat file again.</b>
                </p>
              </div>
            )}

          </div>

        )}

        {/* Timeout - No response received within time limit */}
        {status === "timeout" && (
          <div className="text-center py-6 tt-check-outcome tt-check-timeout">
            <div className="text-amber-600 text-5xl mb-3">⏱️</div>
            <p className="text-amber-700 dark:text-amber-400 font-semibold text-lg mb-4">
              System Check Timed Out
            </p>

            <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 rounded mb-6 text-left max-w-md mx-auto tt-check-panel">
              <p className="text-amber-800 dark:text-amber-200 font-semibold mb-2">
                What this means:
              </p>
              <p className="text-amber-700 dark:text-amber-300 text-sm mb-3">
                The system did not receive a response from the system check within the expected time. This could happen if:
              </p>
              <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300 text-sm space-y-1">
                <li>The .bat file was not executed</li>
                <li>The system check was interrupted or closed</li>
                <li>There was a network connectivity issue</li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded mb-6 text-left max-w-md mx-auto tt-check-panel tt-check-action-panel">
              <p className="text-blue-800 dark:text-blue-200 font-semibold mb-2">
                What to do:
              </p>
              <ol className="list-decimal pl-5 text-blue-700 dark:text-blue-300 text-sm space-y-1">
                <li>Check that you have the .bat file in your Downloads folder</li>
                <li>Run the .bat file again</li>
                <li>Click "Retry" below to check for the results again</li>
              </ol>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setPollingMessage("");
                  startPolling(interviewId);
                }}
                className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold transition"
              >
                Retry Polling
              </button>

              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Passed */}
        {status === "passed" && (
          <div className="text-center py-6 tt-check-outcome tt-check-passed">
            <div className="text-green-600 text-5xl mb-3">✅</div>
            <p className="text-green-700 dark:text-green-400 font-semibold text-lg">
              System check passed!
            </p>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
              Your system is ready for the interview. Redirecting...
            </p>
          </div>
        )}

        {/* Failed */}
        {status === "failed" && (
          <div className="space-y-4 tt-check-outcome tt-check-failed">
            <div className="text-red-600 text-5xl text-center">
              ❌
            </div>
            <div className="text-center">
              <p className="text-red-700 dark:text-red-300 font-bold text-xl">
                System Check Failed
              </p>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                Your system does not meet the requirements for this interview
              </p>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded tt-check-panel tt-check-issues">
              <p className="font-bold text-red-700 dark:text-red-300 mb-3">
                Issues Detected:
              </p>
              <ul className="list-disc pl-5 space-y-2 text-red-700 dark:text-red-300 text-sm">
                {getFailureReasons().map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded tt-check-panel tt-check-action-panel">
              <p className="font-bold text-blue-700 dark:text-blue-300 mb-2">
                What to do:
              </p>
              <ol className="list-decimal pl-5 text-blue-700 dark:text-blue-300 text-sm space-y-1">
                <li>Fix the issues listed above on your system</li>
                <li>Close any extra monitors, disconnect extra peripherals, or exit remote desktop sessions</li>
                <li>Run the .bat file again to re-check your system</li>
              </ol>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setResult(null);
                  setError(null);
                  setStatus("checking");
                  setPollingMessage(
                    "Waiting for system check to complete. Please ensure the .bat file is running..."
                  );
                  startPolling(interviewId);
                }}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold transition"
              >
                Check Again
              </button>

              <button
                onClick={onClose}
                className="px-5 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="space-y-4 tt-check-error">
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded tt-check-panel tt-check-issues">
              <p className="text-red-700 dark:text-red-300 font-semibold mb-2">
                ⚠️ Something Went Wrong
              </p>
              <p className="text-red-600 dark:text-red-400 text-sm mb-4">
                {error}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded tt-check-panel tt-check-action-panel">
              <p className="font-bold text-blue-700 dark:text-blue-300 mb-2">
                How to fix this:
              </p>
              <ol className="list-decimal pl-5 text-blue-700 dark:text-blue-300 text-sm space-y-1">
                <li>Click the button below to go back</li>
                <li>Download the files again</li>
                <li>Run the .bat file and complete the system check</li>
              </ol>
            </div>

            <button
              onClick={() => {
                setStatus("idle");
                setResult(null);
                setError(null);
              }}
              className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold transition"
            >
              Go Back & Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemCheckModal;
