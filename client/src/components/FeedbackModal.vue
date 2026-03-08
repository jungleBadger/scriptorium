<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { submitFeedback } from "../services/api.js";

const MESSAGE_MIN_LENGTH = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERAL_FEEDBACK_KINDS = new Set(["bug_report", "product_feedback"]);

const props = defineProps({
  variant: { type: String, default: "general" },
  payloadContext: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["close", "submitted"]);
const { t } = useI18n();

const modalRef = ref(null);
const messageRef = ref(null);
const emailRef = ref(null);
const submitting = ref(false);
const submitError = ref(null);
const submitErrorType = ref(null);
const submitSuccess = ref(false);
const submitAttempted = ref(false);
const touched = reactive({
  user_message: false,
  contact_email: false,
});
const form = reactive({
  kind: "bug_report",
  user_message: "",
  suggested_fix: "",
  contact_email: "",
  website: "",
});

const ids = {
  title: "feedback-modal-title",
  intro: "feedback-modal-intro",
  message: "feedback-message",
  messageHelp: "feedback-message-help",
  messageCounter: "feedback-message-counter",
  messageError: "feedback-message-error",
  suggestedFix: "feedback-suggested-fix",
  email: "feedback-email",
  emailError: "feedback-email-error",
  submitError: "feedback-submit-error",
  website: "feedback-website",
};

let previousFocus = null;

const isContentReport = computed(() => props.variant === "content");
const sourceLabel = computed(() => String(props.payloadContext?.source_label || "").trim());
const kindOptions = computed(() => [
  { value: "bug_report", label: t("feedback.kinds.bug_report") },
  { value: "product_feedback", label: t("feedback.kinds.product_feedback") },
]);
const modalTitle = computed(() =>
  isContentReport.value ? t("feedback.modal.reportTitle") : t("feedback.modal.sendTitle")
);
const modalKicker = computed(() =>
  isContentReport.value ? t("feedback.modal.reportKicker") : t("feedback.modal.sendKicker")
);
const modalIntro = computed(() =>
  isContentReport.value ? t("feedback.modal.reportIntro") : t("feedback.modal.sendIntro")
);
const messageHelpText = computed(() =>
  isContentReport.value ? t("feedback.modal.contentMessageHelp") : t("feedback.modal.generalMessageHelp")
);
const successTitle = computed(() =>
  isContentReport.value ? t("feedback.modal.reportSuccessTitle") : t("feedback.modal.sendSuccessTitle")
);
const successBody = computed(() =>
  isContentReport.value ? t("feedback.modal.reportSuccessBody") : t("feedback.modal.sendSuccessBody")
);
const headerTitle = computed(() => (submitSuccess.value ? successTitle.value : modalTitle.value));
const headerIntro = computed(() => (submitSuccess.value ? successBody.value : modalIntro.value));
const trimmedMessage = computed(() => String(form.user_message || "").trim());
const trimmedMessageLength = computed(() => trimmedMessage.value.length);
const trimmedSuggestedFix = computed(() => normalizeOptionalText(form.suggested_fix));
const trimmedEmail = computed(() => normalizeOptionalText(form.contact_email));
const trimmedWebsite = computed(() => normalizeOptionalText(form.website));
const isMessageValid = computed(() => trimmedMessageLength.value >= MESSAGE_MIN_LENGTH);
const isEmailValid = computed(() => !trimmedEmail.value || EMAIL_RE.test(trimmedEmail.value));
const canSubmit = computed(() => !submitting.value && isMessageValid.value && isEmailValid.value);
const showMessageError = computed(() => (submitAttempted.value || touched.user_message) && !isMessageValid.value);
const showEmailError = computed(() => (submitAttempted.value || touched.contact_email) && !isEmailValid.value);
const messageCounterState = computed(() => {
  if (isMessageValid.value) return "valid";
  if (trimmedMessageLength.value > 0 || submitAttempted.value || touched.user_message) return "invalid";
  return "neutral";
});
const messageDescribedBy = computed(() => {
  const parts = [ids.messageHelp, ids.messageCounter];
  if (showMessageError.value) parts.push(ids.messageError);
  return parts.join(" ");
});
const emailDescribedBy = computed(() => (showEmailError.value ? ids.emailError : undefined));

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeKind(value) {
  const nextKind = String(value || "").trim();
  return GENERAL_FEEDBACK_KINDS.has(nextKind) ? nextKind : "bug_report";
}

function getFocusable() {
  return Array.from(
    modalRef.value?.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []
  );
}

function trapFocus(event) {
  const focusable = getFocusable();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function requestClose() {
  if (submitting.value) return;
  emit("close");
}

function onKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key === "Tab") {
    trapFocus(event);
  }
}

function resetForm() {
  form.kind = isContentReport.value ? "content_report" : normalizeKind(props.payloadContext?.kind);
  form.user_message = "";
  form.suggested_fix = "";
  form.contact_email = "";
  form.website = "";
  touched.user_message = false;
  touched.contact_email = false;
  submitting.value = false;
  submitAttempted.value = false;
  submitError.value = null;
  submitErrorType.value = null;
  submitSuccess.value = false;
}

function trimFormFields() {
  form.user_message = trimmedMessage.value;
  form.suggested_fix = trimmedSuggestedFix.value || "";
  form.contact_email = trimmedEmail.value || "";
  form.website = trimmedWebsite.value || "";
}

function onMessageBlur() {
  touched.user_message = true;
  form.user_message = trimmedMessage.value;
}

function onEmailBlur() {
  touched.contact_email = true;
  form.contact_email = trimmedEmail.value || "";
}

function onSuggestedFixBlur() {
  form.suggested_fix = trimmedSuggestedFix.value || "";
}

async function focusPrimaryField() {
  await nextTick();
  if (submitSuccess.value) {
    modalRef.value?.querySelector("[data-feedback-success-close]")?.focus();
    return;
  }
  messageRef.value?.focus();
}

async function focusFirstInvalidField() {
  await nextTick();
  if (!isMessageValid.value) {
    messageRef.value?.focus();
    return;
  }
  if (!isEmailValid.value) {
    emailRef.value?.focus();
  }
}

function getSubmitErrorMessage(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  if (code === "FEEDBACK_BAD_REQUEST") return t("feedback.modal.submitErrors.review");
  if (code === "FEEDBACK_TOO_LARGE") return t("feedback.modal.submitErrors.tooLarge");
  if (code === "FEEDBACK_COOLDOWN" || code === "RATE_LIMIT_EXCEEDED") {
    return t("feedback.modal.submitErrors.cooldown");
  }
  if (code === "FEEDBACK_UNAVAILABLE") return t("feedback.modal.submitErrors.unavailable");

  const status = Number(err?.status);
  if (status === 400) return t("feedback.modal.submitErrors.review");
  if (status === 413) return t("feedback.modal.submitErrors.tooLarge");
  if (status === 429) return t("feedback.modal.submitErrors.cooldown");
  if (status === 503) return t("feedback.modal.submitErrors.unavailable");

  return t("feedback.modal.submitErrors.generic");
}

async function onSubmit() {
  if (submitting.value) return;

  submitAttempted.value = true;
  touched.user_message = true;
  touched.contact_email = Boolean(form.contact_email.trim());
  trimFormFields();
  submitError.value = null;
  submitErrorType.value = null;

  if (!isMessageValid.value || !isEmailValid.value) {
    submitError.value = t("feedback.modal.submitErrors.review");
    submitErrorType.value = "review";
    await focusFirstInvalidField();
    return;
  }

  submitting.value = true;

  try {
    await submitFeedback({
      kind: isContentReport.value ? "content_report" : form.kind,
      target_type: props.payloadContext?.target_type ?? null,
      translation: props.payloadContext?.translation ?? null,
      book_id: props.payloadContext?.book_id ?? null,
      chapter: props.payloadContext?.chapter ?? null,
      verse_start: props.payloadContext?.verse_start ?? null,
      verse_end: props.payloadContext?.verse_end ?? null,
      entity_id: props.payloadContext?.entity_id ?? null,
      user_message: trimmedMessage.value,
      suggested_fix: isContentReport.value ? trimmedSuggestedFix.value : null,
      content_snapshot: props.payloadContext?.content_snapshot ?? null,
      generation_metadata: props.payloadContext?.generation_metadata ?? null,
      page_context: props.payloadContext?.page_context ?? null,
      contact_email: trimmedEmail.value,
      website: trimmedWebsite.value,
    });

    submitSuccess.value = true;
    emit("submitted");
    await focusPrimaryField();
  } catch (err) {
    submitError.value = getSubmitErrorMessage(err);
    submitErrorType.value = "api";
  } finally {
    submitting.value = false;
  }
}

watch(
  () => [isMessageValid.value, isEmailValid.value],
  ([messageValid, emailValid]) => {
    if (submitErrorType.value === "review" && messageValid && emailValid) {
      submitError.value = null;
      submitErrorType.value = null;
    }
  }
);

watch(
  () => [props.variant, props.payloadContext],
  async () => {
    resetForm();
    await focusPrimaryField();
  },
  { deep: true, immediate: true }
);

onMounted(async () => {
  previousFocus = document.activeElement;
  document.addEventListener("keydown", onKeydown);
  await focusPrimaryField();
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  previousFocus?.focus();
  previousFocus = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="feedback-modal-backdrop" aria-hidden="true" @click="requestClose" />

    <div
      ref="modalRef"
      class="feedback-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="ids.title"
      :aria-describedby="ids.intro"
      tabindex="-1"
    >
      <div class="feedback-modal-header">
        <div class="feedback-modal-header__copy">
          <p class="feedback-modal-kicker">{{ modalKicker }}</p>
          <h2 :id="ids.title" class="feedback-modal-title">{{ headerTitle }}</h2>
          <p :id="ids.intro" class="feedback-modal-intro">{{ headerIntro }}</p>
        </div>
        <button
          class="nav-icon-btn feedback-modal-close"
          type="button"
          :aria-label="t('feedback.modal.close')"
          :disabled="submitting"
          @click="requestClose"
        >
          ✕
        </button>
      </div>

      <div v-if="submitSuccess" class="feedback-modal-body feedback-modal-body--success" role="status" aria-live="polite">
        <button
          class="primary-btn compact"
          type="button"
          data-feedback-success-close
          @click="requestClose"
        >
          {{ t("feedback.modal.close") }}
        </button>
      </div>

      <form v-else class="feedback-modal-body" novalidate :aria-busy="submitting ? 'true' : 'false'" @submit.prevent="onSubmit">
        <p v-if="sourceLabel" class="feedback-context-chip">{{ sourceLabel }}</p>

        <label v-if="!isContentReport" class="settings-group feedback-field" :for="'feedback-kind'">
          <span class="settings-label">{{ t("feedback.modal.kindLabel") }}</span>
          <select id="feedback-kind" v-model="form.kind" class="field-input settings-select feedback-field-input">
            <option v-for="option in kindOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <div class="settings-group feedback-field">
          <label class="settings-label" :for="ids.message">
            {{ isContentReport ? t("feedback.modal.contentMessageLabel") : t("feedback.modal.generalMessageLabel") }}
          </label>
          <textarea
            :id="ids.message"
            ref="messageRef"
            v-model="form.user_message"
            class="field-input feedback-textarea feedback-field-input"
            :class="{
              'feedback-field-input--invalid': showMessageError,
              'feedback-field-input--valid': trimmedMessageLength > 0 && isMessageValid,
            }"
            rows="5"
            :maxlength="3000"
            :placeholder="isContentReport ? t('feedback.modal.contentMessagePlaceholder') : t('feedback.modal.generalMessagePlaceholder')"
            :aria-invalid="showMessageError ? 'true' : 'false'"
            :aria-describedby="messageDescribedBy"
            required
            name="user_message"
            @blur="onMessageBlur"
          />
          <div class="feedback-field-foot">
            <p :id="ids.messageHelp" class="feedback-field-help">{{ messageHelpText }}</p>
            <p
              :id="ids.messageCounter"
              class="feedback-field-counter"
              :class="`feedback-field-counter--${messageCounterState}`"
            >
              {{ t("feedback.modal.messageCounter", { current: trimmedMessageLength, minimum: MESSAGE_MIN_LENGTH }) }}
            </p>
          </div>
          <p
            v-if="showMessageError"
            :id="ids.messageError"
            class="feedback-field-error"
            role="status"
            aria-live="polite"
          >
            {{ t("feedback.modal.validation.messageMin", { minimum: MESSAGE_MIN_LENGTH }) }}
          </p>
        </div>

        <div v-if="isContentReport" class="settings-group feedback-field">
          <label class="settings-label" :for="ids.suggestedFix">{{ t("feedback.modal.suggestedFixLabel") }}</label>
          <textarea
            :id="ids.suggestedFix"
            v-model="form.suggested_fix"
            class="field-input feedback-textarea feedback-field-input"
            rows="4"
            :maxlength="3000"
            :placeholder="t('feedback.modal.suggestedFixPlaceholder')"
            name="suggested_fix"
            @blur="onSuggestedFixBlur"
          />
        </div>

        <div class="settings-group feedback-field">
          <label class="settings-label" :for="ids.email">{{ t("feedback.modal.emailLabel") }}</label>
          <input
            :id="ids.email"
            ref="emailRef"
            v-model="form.contact_email"
            type="email"
            class="field-input feedback-field-input"
            :class="{
              'feedback-field-input--invalid': showEmailError,
              'feedback-field-input--valid': trimmedEmail && isEmailValid,
            }"
            maxlength="320"
            :placeholder="t('feedback.modal.emailPlaceholder')"
            autocomplete="email"
            autocapitalize="none"
            inputmode="email"
            spellcheck="false"
            name="contact_email"
            :aria-invalid="showEmailError ? 'true' : 'false'"
            :aria-describedby="emailDescribedBy"
            @blur="onEmailBlur"
          />
          <p
            v-if="showEmailError"
            :id="ids.emailError"
            class="feedback-field-error"
            role="status"
            aria-live="polite"
          >
            {{ t("feedback.modal.validation.email") }}
          </p>
        </div>

        <div class="feedback-honeypot" aria-hidden="true">
          <label :for="ids.website" aria-hidden="true">{{ t("feedback.modal.websiteLabel") }}</label>
          <input
            :id="ids.website"
            v-model="form.website"
            type="text"
            tabindex="-1"
            autocomplete="off"
            aria-hidden="true"
            name="website"
          />
        </div>

        <p class="settings-help-text feedback-privacy-note">{{ t("feedback.modal.privacyNote") }}</p>

        <p
          v-if="submitError"
          :id="ids.submitError"
          class="feedback-submit-banner"
          role="status"
          aria-live="polite"
        >
          {{ submitError }}
        </p>

        <div class="feedback-modal-actions">
          <button class="ghost-btn compact feedback-action-btn" type="button" :disabled="submitting" @click="requestClose">
            {{ t("feedback.modal.cancel") }}
          </button>
          <button
            class="primary-btn compact feedback-action-btn feedback-submit-btn"
            type="submit"
            :disabled="!canSubmit"
          >
            {{ submitting ? t("feedback.modal.submitting") : t("feedback.modal.submit") }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
