export const normalize = value => String(value || "").replace(/\s+/gu, " ").trim();

export function safeReturnPath(value, origin) {
  try {
    const url = new URL(value || "/", origin);
    if (url.origin !== origin || !/^\/(?:zh\/)?(?:patterns|cases|topics|workshops|concepts|contribute)(?:\/|$)/.test(url.pathname)) return "/contribute/";
    return url.pathname + url.hash;
  } catch { return "/contribute/"; }
}

export function counterpart(path) {
  return path.startsWith("/zh/") ? path.slice(3) : "/zh" + path;
}

export function collectBlocks(article) {
  if (!article) return [];
  return [...article.querySelectorAll("p,li,pre,table,figure")].filter(el => {
    if (el.closest("footer,nav,aside,.publication-cite,.chronicle-meta,.publication-meta,.adps-widget")) return false;
    if (el.closest("header") && !el.matches("[data-adps-source]")) return false;
    const outer = el.closest("table,pre,figure");
    if (outer && outer !== el) return false;
    if (el.querySelector("p,li,pre,table,figure")) return el.matches("table,pre,figure");
    return true;
  }).filter(el => {
    const text = normalize(el.textContent);
    return text.length >= 12 && text.length <= 24000;
  });
}

export function validateDraft(draft) {
  if (!draft?.body?.trim() || draft.body.trim().length > 12000) return "invalid_submission";
  if (!draft.quote || !draft.block_id || !draft.block_revision || !draft.document_path) return "invalid_quote";
  return null;
}

export function publicLink(record) {
  const path = safeReturnPath(record.document_path, "https://adpsagent.com");
  return path + "#discussion-" + record.proposal_id;
}

export const errors = {
  zh: {
    login_required: "请先用 GitHub 登录。",
    github_required: "请使用 GitHub 账号登录。",
    stale_passage: "这段原文已更新。请刷新页面，重新选择原文。",
    invalid_quote: "引用与原文不一致，请重新选择。",
    invalid_submission: "请填写建议，最多 12,000 字符。",
    revision_conflict: "内容已被更新，请刷新后再操作。",
    rate_limited: "提交较频繁，请稍后再试。草稿仍保留。",
    consent_required: "投稿者未同意公开，这条建议只能内部审阅。",
    moderator_required: "当前账号没有审核权限。",
    invalid_parent: "这条讨论已不可回复，请重新选择原文。",
    parent_not_public: "原讨论已隐藏，不能公开这条回复。",
    not_found: "记录不存在，或当前账号无权访问。",
    idempotency_conflict: "上次提交已被接收。请在“我的贡献”中修改。",
    fallback: "操作未完成，请稍后重试。未提交的草稿仍保留。"
  },
  en: {
    login_required: "Sign in with GitHub first.",
    github_required: "Please use a GitHub account.",
    stale_passage: "This passage has changed. Reload and select it again.",
    invalid_quote: "The quotation does not match the passage. Select it again.",
    invalid_submission: "Enter a suggestion of up to 12,000 characters.",
    revision_conflict: "This record has changed. Refresh before continuing.",
    rate_limited: "Too many submissions. Try again later; your draft is saved.",
    consent_required: "The contributor has not agreed to public discussion.",
    moderator_required: "This account cannot review submissions.",
    invalid_parent: "This discussion is no longer available for replies.",
    parent_not_public: "The parent discussion is hidden.",
    not_found: "The record is unavailable to this account.",
    idempotency_conflict: "The earlier submission was received. Edit it under My contributions.",
    fallback: "The request could not be completed. Try again later; your draft is saved."
  }
};

export function errorText(error, lang) {
  const key = Object.keys(errors[lang]).find(k => String(error?.message || error).includes(k));
  return errors[lang][key || "fallback"];
}
