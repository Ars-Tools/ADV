(() => {
    'use strict';

    const playerSelector = '#movie_player, .html5-video-player';
    const skipSelector = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton';
    const adIndicatorSelector = '.ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-duration-remaining';
    const saved = new Map();
    const suppressed = new WeakSet();
    let scheduled = false;
    let observer;

    const isVisible = element => element && !element.hidden &&
        getComputedStyle(element).display !== 'none' &&
        getComputedStyle(element).visibility !== 'hidden' &&
        element.getClientRects().length > 0;

    function restore(video, state) {
        // Preserve any user change made while an ad was being handled.
        if (video.muted === true) video.muted = state.muted;
        if (video.playbackRate === 16) video.playbackRate = state.rate;
        saved.delete(video);
    }

    function update() {
        scheduled = false;
        if (document.hidden) return;
        const active = new Set();
        for (const player of document.querySelectorAll(playerSelector)) {
            const isAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
            if (!isAd) {
                suppressed.delete(player);
                continue;
            }
            // Click only an explicit, visible skip control in the ad player.
            const skip = [...player.querySelectorAll(skipSelector)].find(button => isVisible(button) &&
                !button.disabled && button.getAttribute('aria-disabled') !== 'true');
            if (skip) skip.click();
            if (!player.classList.contains('ad-showing') && !player.classList.contains('ad-interrupting')) continue;
            // Require a second, visible ad signal before touching media playback.
            // A class alone can remain stale while a regular video starts.
            const indicator = [...player.querySelectorAll(adIndicatorSelector)].some(isVisible);
            if (!indicator || suppressed.has(player)) continue;
            const video = player.querySelector('video');
            if (!video) continue;
            active.add(video);
            if (!saved.has(video)) saved.set(video, { muted: video.muted, rate: video.playbackRate, source: video.currentSrc });
            const state = saved.get(video);
            if (video.currentSrc !== state.source) {
                // Never seek into a new media source while old ad UI is clearing.
                suppressed.add(player);
                restore(video, state);
                continue;
            }
            video.muted = true;
            try {
                // For an identified finite ad, trigger its normal end transition.
                // Do not seek live streams or unknown/long timelines.
                if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 300) {
                    if (video.currentTime < video.duration - 0.1) video.currentTime = video.duration;
                } else {
                    video.playbackRate = 16;
                }
            } catch (_) {
                // Some players disallow seeking; restore on the next ad-state change.
            }
        }
        for (const [video, state] of saved) {
            if (!active.has(video) || !video.isConnected) restore(video, state);
        }
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        // Coalesce DOM changes without relying on rendering frames (Safari can
        // throttle requestAnimationFrame for an offscreen embedded player).
        setTimeout(update, 50);
    }

    function start() {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { subtree: true, childList: true,
            attributes: true, attributeFilter: ['class', 'hidden', 'disabled', 'aria-disabled', 'style'] });
        schedule();
    }

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    // Handles YouTube's single-page navigation and media-only updates.
    document.addEventListener('yt-navigate-finish', schedule);
    document.addEventListener('loadedmetadata', schedule, true);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            for (const [video, state] of saved) restore(video, state);
        } else schedule();
    });
    const timer = setInterval(() => { if (!document.hidden) schedule(); }, 500);
    window.addEventListener('pagehide', () => {
        for (const [video, state] of saved) restore(video, state);
    });
    window.addEventListener('pageshow', schedule);
})();
