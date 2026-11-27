"use client";

export default function HeaderBrandLink() {
  return (
    <a
      className="site-header__brand"
      href="/"
      aria-label="Insurance Simplified home"
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        const state = { ...window.history.state, appPage: "welcome" };
        window.history.pushState(state, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate", { state }));
      }}
    >
      <img src="/insurance-simplified-icon.png" alt="" aria-hidden="true" />
      <span className="site-header__wordmark">
        Insurance<b>Simplified</b>
      </span>
    </a>
  );
}
