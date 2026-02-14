import {
  DELETE_CONFIRMATION_PHRASE,
  DeleteAccountApiError,
  clearDeletionSession,
  completeHostedSignInForDeletion,
  getAuthenticatedUserLabel,
  getDeleteAccountAuthCapabilities,
  getStoredDeletionSession,
  requestDeleteVerificationCode,
  signInForDeletion,
  startGoogleSignInForDeletion,
  startHostedSignInForDeletion,
  submitDeleteAccountRequest,
  verifyDeleteVerificationCode,
} from "./deleteAccountApi.js";

function initializeDeleteAccountFlow() {
  const panels = document.querySelectorAll("[data-state-panel]");
  const stepNodes = document.querySelectorAll(
    ".delete-steps [data-step-index]",
  );

  const loginForm = document.getElementById("delete-login-form");
  const codeForm = document.getElementById("delete-code-form");
  const confirmForm = document.getElementById("delete-confirm-form");

  const globalFeedback = document.getElementById("delete-global-feedback");
  const loginFeedback = document.getElementById("delete-login-feedback");
  const codeFeedback = document.getElementById("delete-code-feedback");

  const authenticatedUser = document.getElementById(
    "delete-authenticated-user",
  );
  const codeDestination = document.getElementById("delete-code-destination");

  const successMessage = document.getElementById("delete-success-message");
  const errorMessage = document.getElementById("delete-error-message");

  const loginSubmitButton = document.getElementById("delete-login-submit");
  const googleSignInButton = document.getElementById("delete-google-signin");
  const hostedSignInButton = document.getElementById("delete-hosted-signin");

  const sendEmailCodeButton = document.getElementById("send-email-code-button");
  const resendEmailCodeButton = document.getElementById(
    "resend-email-code-button",
  );

  const restartFromAuthenticated = document.getElementById(
    "restart-from-authenticated",
  );
  const backToAuthenticated = document.getElementById("back-to-authenticated");
  const backToCodePanel = document.getElementById("back-to-code-panel");
  const errorBackButton = document.getElementById("delete-error-back");
  const successResetButton = document.getElementById("success-reset-button");

  const irreversibleCheck = document.getElementById(
    "delete-irreversible-check",
  );
  const confirmationInput = document.getElementById("delete-confirm-phrase");
  const submitDeleteButton = document.getElementById("submit-delete-request");

  const identifierInput = document.getElementById("delete-identifier");
  const passwordInput = document.getElementById("delete-password");
  const codeInput = document.getElementById("delete-email-code");

  if (
    !panels.length ||
    !stepNodes.length ||
    !loginForm ||
    !codeForm ||
    !confirmForm ||
    !globalFeedback ||
    !loginFeedback ||
    !codeFeedback ||
    !authenticatedUser ||
    !codeDestination ||
    !successMessage ||
    !errorMessage ||
    !loginSubmitButton ||
    !googleSignInButton ||
    !hostedSignInButton ||
    !sendEmailCodeButton ||
    !resendEmailCodeButton ||
    !restartFromAuthenticated ||
    !backToAuthenticated ||
    !backToCodePanel ||
    !errorBackButton ||
    !successResetButton ||
    !irreversibleCheck ||
    !confirmationInput ||
    !submitDeleteButton ||
    !identifierInput ||
    !passwordInput ||
    !codeInput
  ) {
    return;
  }

  const authCapabilities = getDeleteAccountAuthCapabilities();

  let currentState = "unauthenticated";
  let recoveryState = "unauthenticated";
  let errorStep = 1;

  let authSession = null;
  let deleteVerificationToken = "";
  let deleteVerificationExpiresAt = 0;

  const stepByState = {
    unauthenticated: 1,
    authenticating: 1,
    authenticated: 2,
    sendingCode: 2,
    codeSent: 2,
    verifyingCode: 2,
    confirming: 3,
    submitting: 4,
    success: 4,
    error: 4,
  };

  const setFeedback = (element, message, tone) => {
    if (!message) {
      element.classList.add("hidden");
      element.textContent = "";
      return;
    }
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.remove("hidden");
  };

  const setGlobalFeedback = (message, tone = "success") => {
    setFeedback(globalFeedback, message, tone);
  };

  const setLoginFeedback = (message, tone = "error") => {
    setFeedback(loginFeedback, message, tone);
  };

  const setCodeFeedback = (message, tone = "error") => {
    setFeedback(codeFeedback, message, tone);
  };

  const updateStepUI = (state) => {
    const activeStep = state === "error" ? errorStep : stepByState[state] || 1;

    stepNodes.forEach((node) => {
      const stepIndex = Number(node.getAttribute("data-step-index"));
      node.classList.remove("is-current", "is-complete");

      if (stepIndex < activeStep) {
        node.classList.add("is-complete");
      } else if (stepIndex === activeStep) {
        node.classList.add("is-current");
      }
    });
  };

  const setState = (state) => {
    currentState = state;
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-state-panel") !== state;
    });
    updateStepUI(state);
  };

  const hasValidDeleteVerificationToken = () => {
    if (!deleteVerificationToken) {
      return false;
    }
    if (!deleteVerificationExpiresAt) {
      return true;
    }
    return Date.now() < deleteVerificationExpiresAt;
  };

  const canSubmitDelete = () => {
    return (
      Boolean(irreversibleCheck.checked) &&
      confirmationInput.value.trim() === DELETE_CONFIRMATION_PHRASE &&
      hasValidDeleteVerificationToken()
    );
  };

  const updateDeleteSubmitEnabled = () => {
    submitDeleteButton.disabled = !canSubmitDelete();
  };

  const clearDeleteVerification = () => {
    deleteVerificationToken = "";
    deleteVerificationExpiresAt = 0;
    codeForm.reset();
    setCodeFeedback("", "success");
    updateDeleteSubmitEnabled();
  };

  const clearAuthSession = () => {
    authSession = null;
    clearDeletionSession();
    clearDeleteVerification();
    authenticatedUser.textContent = "Authenticated user";
  };

  const setAuthenticatedState = (session) => {
    authSession = session;
    authenticatedUser.textContent = getAuthenticatedUserLabel(session);
    recoveryState = "unauthenticated";
    setState("authenticated");
  };

  const resetFlow = () => {
    clearAuthSession();
    loginForm.reset();
    confirmForm.reset();
    setGlobalFeedback("", "success");
    setLoginFeedback("", "success");
    setCodeFeedback("", "success");
    updateDeleteSubmitEnabled();
    setState("unauthenticated");
  };

  const applyAuthCapabilities = () => {
    if (!authCapabilities.password) {
      loginSubmitButton.disabled = true;
      identifierInput.disabled = true;
      passwordInput.disabled = true;
    }

    googleSignInButton.hidden = !authCapabilities.google;
    hostedSignInButton.hidden = !authCapabilities.hosted;

    if (
      !authCapabilities.password &&
      !authCapabilities.google &&
      !authCapabilities.hosted
    ) {
      setLoginFeedback(
        "Delete-account sign-in is not configured. Contact support at lux.corp.app@gmail.com.",
        "error",
      );
      return;
    }

    if (!authCapabilities.password) {
      setLoginFeedback(
        'Use "Sign in on Cognito page" to sign in or create an account before deletion.',
        "success",
      );
    }
  };

  const handleSessionExpired = () => {
    clearAuthSession();
    loginForm.reset();
    setGlobalFeedback("", "success");
    setCodeFeedback("", "success");
    setLoginFeedback("Session expired. Sign in again to continue.", "error");
    setState("unauthenticated");
  };

  const sendVerificationCode = async ({
    recoveryOnError = "authenticated",
  } = {}) => {
    if (!authSession) {
      handleSessionExpired();
      return;
    }

    setGlobalFeedback("", "success");
    setCodeFeedback("", "success");
    setState("sendingCode");

    try {
      const result = await requestDeleteVerificationCode(authSession);
      clearDeleteVerification();
      codeDestination.textContent =
        String(result?.destinationMasked || "").trim() || "your email";
      setCodeFeedback("Code sent. Enter it below.", "success");
      recoveryState = "authenticated";
      setState("codeSent");
    } catch (error) {
      if (error instanceof DeleteAccountApiError && error.statusCode === 401) {
        handleSessionExpired();
        return;
      }

      errorMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to send verification code right now.";
      recoveryState = recoveryOnError;
      errorStep = stepByState[recoveryState] || 2;
      setState("error");
    }
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!authCapabilities.password) {
      setLoginFeedback(
        "Password sign-in is unavailable here. Use Cognito sign-in page instead.",
        "error",
      );
      return;
    }

    const formData = new FormData(loginForm);
    const identifier = String(formData.get("identifier") || "").trim();
    const password = String(formData.get("password") || "");

    if (!identifier || !password) {
      setLoginFeedback("Username/email and password are required.", "error");
      return;
    }

    setGlobalFeedback("", "success");
    setLoginFeedback("", "success");
    setState("authenticating");

    try {
      const result = await signInForDeletion(identifier, password);
      clearDeleteVerification();
      setAuthenticatedState(result.session);
      setGlobalFeedback(
        "Sign-in verified. Send an email code to continue.",
        "success",
      );
    } catch (error) {
      setState("unauthenticated");
      setLoginFeedback(
        error instanceof Error
          ? error.message
          : "Sign-in failed. Check your credentials and try again.",
        "error",
      );
    }
  });

  googleSignInButton.addEventListener("click", async () => {
    setGlobalFeedback("", "success");
    setLoginFeedback("", "success");
    setState("authenticating");

    try {
      await startGoogleSignInForDeletion();
    } catch (error) {
      setState("unauthenticated");
      setLoginFeedback(
        error instanceof Error
          ? error.message
          : "Unable to start Google sign-in.",
        "error",
      );
    }
  });

  hostedSignInButton.addEventListener("click", async () => {
    setGlobalFeedback("", "success");
    setLoginFeedback("", "success");
    setState("authenticating");

    try {
      await startHostedSignInForDeletion();
    } catch (error) {
      setState("unauthenticated");
      setLoginFeedback(
        error instanceof Error
          ? error.message
          : "Unable to start Cognito sign-in.",
        "error",
      );
    }
  });

  sendEmailCodeButton.addEventListener("click", async () => {
    await sendVerificationCode({ recoveryOnError: "authenticated" });
  });

  resendEmailCodeButton.addEventListener("click", async () => {
    await sendVerificationCode({ recoveryOnError: "codeSent" });
  });

  backToAuthenticated.addEventListener("click", () => {
    setGlobalFeedback("", "success");
    setCodeFeedback("", "success");
    setState("authenticated");
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!authSession) {
      handleSessionExpired();
      return;
    }

    const formData = new FormData(codeForm);
    const code = String(formData.get("code") || "").trim();

    if (!code) {
      setCodeFeedback(
        "Enter the verification code sent to your email.",
        "error",
      );
      return;
    }

    setGlobalFeedback("", "success");
    setCodeFeedback("", "success");
    setState("verifyingCode");

    try {
      const result = await verifyDeleteVerificationCode(authSession, code);
      deleteVerificationToken =
        String(result?.deleteVerificationToken || "").trim() || "";
      deleteVerificationExpiresAt = Number(result?.expiresAt || 0) * 1000;
      codeForm.reset();
      updateDeleteSubmitEnabled();
      setGlobalFeedback(
        "Email verified. Confirm deletion to finish the request.",
        "success",
      );
      recoveryState = "codeSent";
      setState("confirming");
    } catch (error) {
      if (error instanceof DeleteAccountApiError && error.statusCode === 401) {
        handleSessionExpired();
        return;
      }

      if (
        error instanceof DeleteAccountApiError &&
        error.errorCode === "invalid_or_expired_code"
      ) {
        setState("codeSent");
        setCodeFeedback(error.message, "error");
        return;
      }

      errorMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to verify that code right now.";
      recoveryState = "codeSent";
      errorStep = stepByState[recoveryState] || 2;
      setState("error");
    }
  });

  backToCodePanel.addEventListener("click", () => {
    setGlobalFeedback("", "success");
    setState("codeSent");
  });

  restartFromAuthenticated.addEventListener("click", resetFlow);
  successResetButton.addEventListener("click", resetFlow);

  errorBackButton.addEventListener("click", () => {
    setGlobalFeedback("", "success");
    setState(recoveryState);
  });

  [irreversibleCheck, confirmationInput].forEach((element) => {
    element.addEventListener("input", updateDeleteSubmitEnabled);
    element.addEventListener("change", updateDeleteSubmitEnabled);
  });

  confirmForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!authSession) {
      handleSessionExpired();
      return;
    }

    if (!hasValidDeleteVerificationToken()) {
      clearDeleteVerification();
      setGlobalFeedback(
        "Email verification expired. Send and verify a new code.",
        "error",
      );
      setState("authenticated");
      return;
    }

    if (!canSubmitDelete()) {
      setGlobalFeedback(
        "Check the irreversible confirmation and type DELETE exactly.",
        "error",
      );
      return;
    }

    setGlobalFeedback("", "success");
    setState("submitting");

    try {
      const result = await submitDeleteAccountRequest({
        session: authSession,
        deleteVerificationToken,
      });

      const requestId = String(result?.requestId || "").trim();
      const statusText =
        String(result?.status || "pending").trim() || "pending";
      const requestLine = requestId ? ` Request ID: ${requestId}.` : "";

      successMessage.textContent =
        String(result?.message || "").trim() ||
        `Deletion request submitted with status: ${statusText}.${requestLine}`;

      clearAuthSession();
      confirmForm.reset();
      updateDeleteSubmitEnabled();
      setGlobalFeedback("Deletion request submitted.", "success");
      setState("success");
    } catch (error) {
      if (error instanceof DeleteAccountApiError && error.statusCode === 401) {
        handleSessionExpired();
        return;
      }

      if (
        error instanceof DeleteAccountApiError &&
        (error.errorCode === "delete_verification_required" ||
          error.statusCode === 412)
      ) {
        clearDeleteVerification();
        errorMessage.textContent = error.message;
        recoveryState = "authenticated";
        errorStep = stepByState[recoveryState] || 2;
        setState("error");
        return;
      }

      errorMessage.textContent =
        error instanceof Error
          ? error.message
          : "Unable to submit your deletion request right now.";
      recoveryState = "confirming";
      errorStep = 4;
      setState("error");
    }
  });

  updateDeleteSubmitEnabled();
  applyAuthCapabilities();
  setState(currentState);

  (async () => {
    setState("authenticating");
    setGlobalFeedback("", "success");

    try {
      const redirectResult = await completeHostedSignInForDeletion();
      if (redirectResult.handled && redirectResult.error) {
        setState("unauthenticated");
        setLoginFeedback(redirectResult.error, "error");
        return;
      }

      authSession =
        (redirectResult.handled && redirectResult.session) ||
        getStoredDeletionSession();

      if (authSession) {
        setAuthenticatedState(authSession);
        setGlobalFeedback(
          "Sign-in verified. Send an email code to continue.",
          "success",
        );
        return;
      }

      setState("unauthenticated");
    } catch (error) {
      setState("unauthenticated");
      setLoginFeedback(
        error instanceof Error
          ? error.message
          : "Unable to complete sign-in. Please try again.",
        "error",
      );
    }
  })();
}

document.addEventListener("DOMContentLoaded", initializeDeleteAccountFlow);
