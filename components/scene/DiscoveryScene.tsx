"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  anchor,
  cameraForTopic,
  clipPlacement,
  limitCamera,
  origin,
} from "./geometry";
import type { Point, Viewport } from "./geometry";
import { Evidence, MediaIcon, platformLabel } from "./Evidence";
import { Icon } from "./Icon";
import type { SceneBrief, SceneOpportunity } from "./types";
import s from "./Scene.module.css";

type SceneNav = {
  topicId: string | null;
  clipId: string | null;
  overlay: "index" | "coverage" | null;
};
const home: SceneNav = { topicId: null, clipId: null, overlay: null };
type Visit = { owner: string; nav: SceneNav; camera: Point; step: number };
type Gesture = {
  id: number;
  start: Point;
  previous: Point;
  lastTime: number;
  speed: Point;
  moved: boolean;
};

function weekText(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const a = new Date(start + "T12:00:00Z");
  const b = new Date(end + "T12:00:00Z");
  return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())
    ? null
    : `${format.format(a)} – ${format.format(b)}`;
}

function stamp(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Los_Angeles",
    }).format(new Date(value)) + " Pacific"
  );
}

export default function DiscoveryScene({
  brief,
  initialId,
  initialClipId,
  accountAction,
  showPreviewLink = false,
}: {
  brief: SceneBrief;
  initialId?: string;
  initialClipId?: string;
  accountAction?: React.ReactNode;
  showPreviewLink?: boolean;
}) {
  const initialTopic = brief.opportunities.find(
    (item) => item.id === initialId,
  );
  const initialNav = useRef<SceneNav>(
    initialTopic
      ? {
          topicId: initialTopic.id,
          clipId:
            initialTopic.clips.find((c) => c.id === initialClipId)?.id ?? null,
          overlay: null,
        }
      : home,
  );
  const [nav, setNav] = useState(initialNav.current);
  const [camera, setCamera] = useState(origin);
  const [viewport, setViewport] = useState<Viewport>({
    width: 1200,
    height: 790,
  });
  const [dragging, setDragging] = useState(false);
  const [focusClip, setFocusClip] = useState<{
    topicId: string;
    clipId: string;
  } | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const scene = useRef<HTMLElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const cameraRef = useRef(camera);
  const navRef = useRef(nav);
  const frame = useRef(0);
  const suppress = useRef(false);
  const triggerRect = useRef<DOMRect | null>(null);
  const restoreFocus = useRef(new Map<number, HTMLElement>());
  const instance = useId();
  const step = useRef(0);
  const topics = brief.opportunities;
  const selectedIndex = topics.findIndex((item) => item.id === nav.topicId);
  const topic = topics[selectedIndex];
  const clip = topic?.clips.find((item) => item.id === nav.clipId);
  const focusedMedia =
    topic?.clips.filter(
      (post) => post.thumbnail && !failed.has(post.thumbnail),
    ) ?? [];
  const centerClip = Math.max(
    0,
    focusedMedia.findIndex(
      (post) =>
        topic?.id === focusClip?.topicId && post.id === focusClip?.clipId,
    ),
  );
  const inspecting = !!clip;
  const showModal = inspecting || !!nav.overlay;
  const period = weekText(brief.weekStart, brief.weekEnd);
  const [movingBetween, setMovingBetween] = useState(false);
  const transitionTimer = useRef(0);

  const putCamera = useCallback((point: Point) => {
    cameraRef.current = point;
    setCamera(point);
  }, []);

  const update = useCallback(
    (next: SceneNav, point: Point, animate = true) => {
      cancelAnimationFrame(frame.current);
      if (animate) {
        setMovingBetween(true);
        window.clearTimeout(transitionTimer.current);
        transitionTimer.current = window.setTimeout(
          () => setMovingBetween(false),
          500,
        );
      }
      navRef.current = next;
      setNav(next);
      putCamera(point);
    },
    [putCamera],
  );

  useEffect(() => {
    function visit(event: PopStateEvent) {
      const entry = event.state?.discoveryScene as Visit | undefined;
      if (entry?.owner !== instance) return;
      const previousStep = step.current;
      step.current = entry.step;
      update(entry.nav, entry.camera);
      if (entry.step < previousStep)
        requestAnimationFrame(() =>
          restoreFocus.current
            .get(previousStep)
            ?.focus({ preventScroll: true }),
        );
    }
    const existing = history.state?.discoveryScene as Visit | undefined;
    if (existing?.owner === instance) {
      step.current = existing.step;
      update(existing.nav, existing.camera, false);
    } else {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("opportunity");
      const direct = brief.opportunities.find((item) => item.id === id);
      if (direct) {
        initialNav.current = {
          topicId: direct.id,
          clipId:
            direct.clips.find((c) => c.id === url.searchParams.get("clip"))
              ?.id ?? null,
          overlay: null,
        };
      }
      const entry: Visit = {
        owner: instance,
        nav: initialNav.current,
        camera: origin,
        step: 0,
      };
      update(entry.nav, origin, false);
      history.replaceState({ ...history.state, discoveryScene: entry }, "");
    }
    window.addEventListener("popstate", visit);
    return () => {
      window.removeEventListener("popstate", visit);
      cancelAnimationFrame(frame.current);
      window.clearTimeout(transitionTimer.current);
    };
  }, [instance, update, brief.opportunities]);

  useLayoutEffect(() => {
    const element = scene.current;
    if (!element) return;
    function measure() {
      if (element)
        setViewport({
          width: element.clientWidth,
          height: element.clientHeight,
        });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const dialog = modal.current;
    if (showModal && dialog) {
      if (!dialog.open) dialog.showModal();
      if (!dialog.contains(document.activeElement))
        dialog
          .querySelector<HTMLButtonElement>("button")
          ?.focus({ preventScroll: true });
    } else if (dialog?.open) dialog.close();
  }, [showModal, inspecting, nav.overlay]);

  function navigate(
    next: SceneNav,
    point = cameraRef.current,
    trigger?: HTMLElement,
    replace = false,
  ) {
    const current: Visit = {
      owner: instance,
      nav: navRef.current,
      camera: cameraRef.current,
      step: step.current,
    };
    history.replaceState({ ...history.state, discoveryScene: current }, "");
    if (!replace) {
      step.current += 1;
      if (trigger) restoreFocus.current.set(step.current, trigger);
    }
    const dest: Visit = {
      owner: instance,
      nav: next,
      camera: point,
      step: step.current,
    };
    const url = new URL(window.location.href);
    if (next.topicId) url.searchParams.set("opportunity", next.topicId);
    else url.searchParams.delete("opportunity");
    if (next.clipId) url.searchParams.set("clip", next.clipId);
    else url.searchParams.delete("clip");
    if (replace)
      history.replaceState({ ...history.state, discoveryScene: dest }, "", url);
    else history.pushState({ ...history.state, discoveryScene: dest }, "", url);
    update(next, point);
  }

  function back() {
    if (step.current > 0) history.back();
    else if (nav.clipId) {
      navigate(
        { topicId: nav.topicId, clipId: null, overlay: null },
        cameraRef.current,
        undefined,
        true,
      );
      requestAnimationFrame(() =>
        world.current
          ?.querySelector<HTMLElement>('[data-active-clip="first"]')
          ?.focus({ preventScroll: true }),
      );
    } else {
      navigate(home, origin, undefined, true);
      requestAnimationFrame(() =>
        world.current
          ?.querySelector<HTMLElement>('[data-testid="scene-topic"]')
          ?.focus({ preventScroll: true }),
      );
    }
  }

  function focusTopic(
    target: SceneOpportunity,
    trigger: HTMLElement,
    replace = false,
  ) {
    const index = topics.findIndex((item) => item.id === target.id);
    setFocusClip(null);
    navigate(
      { topicId: target.id, clipId: null, overlay: null },
      cameraForTopic(index, viewport, topics.length),
      trigger,
      replace,
    );
    requestAnimationFrame(() =>
      world.current
        ?.querySelector<HTMLElement>(`[data-active-clip="first"]`)
        ?.focus({ preventScroll: true }),
    );
  }

  function inspect(target: SceneOpportunity, id: string, trigger: HTMLElement) {
    triggerRect.current = trigger.getBoundingClientRect();
    navigate(
      { topicId: target.id, clipId: id, overlay: null },
      cameraRef.current,
      trigger,
    );
  }

  function stepClip(offset: number) {
    if (!topic || !focusedMedia.length) return;
    const index =
      (centerClip + offset + focusedMedia.length) % focusedMedia.length;
    setFocusClip({ topicId: topic.id, clipId: focusedMedia[index].id });
    setMovingBetween(true);
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = window.setTimeout(
      () => setMovingBetween(false),
      500,
    );
  }

  function cancelGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      selectedIndex >= 0 ||
      showModal
    )
      return;
    cancelAnimationFrame(frame.current);
    setMovingBetween(false);
    const p = { x: event.clientX, y: event.clientY };
    gesture.current = {
      id: event.pointerId,
      start: p,
      previous: p,
      speed: origin,
      lastTime: event.timeStamp,
      moved: false,
    };
    suppress.current = false;
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    const x = event.clientX,
      y = event.clientY;
    if (!g.moved && Math.hypot(x - g.start.x, y - g.start.y) < 7) return;
    if (!g.moved) {
      g.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    const dt = Math.max(8, event.timeStamp - g.lastTime);
    const dx = x - g.previous.x,
      dy = y - g.previous.y;
    g.speed = { x: dx / dt, y: dy / dt };
    g.previous = { x, y };
    g.lastTime = event.timeStamp;
    putCamera(
      limitCamera(
        { x: cameraRef.current.x + dx, y: cameraRef.current.y + dy },
        viewport,
      ),
    );
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    cancelGesture(event);
    if (!g.moved) return;
    suppress.current = true;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      event.timeStamp - g.lastTime > 90
    )
      return;
    let speed = {
      x: Math.max(-1.7, Math.min(1.7, g.speed.x)),
      y: Math.max(-1.7, Math.min(1.7, g.speed.y)),
    };
    let last = performance.now();
    function coast(now: number) {
      const dt = Math.min(now - last, 35);
      last = now;
      const decay = Math.exp(-dt / 125);
      speed = { x: speed.x * decay, y: speed.y * decay };
      const previous = cameraRef.current;
      const next = limitCamera(
        { x: previous.x + dt * speed.x, y: previous.y + dt * speed.y },
        viewport,
      );
      putCamera(next);
      if (Math.hypot(next.x - previous.x, next.y - previous.y) > 0.14)
        frame.current = requestAnimationFrame(coast);
    }
    frame.current = requestAnimationFrame(coast);
  }

  function imageFailed(url: string) {
    setFailed((previous) =>
      previous.has(url) ? previous : new Set(previous).add(url),
    );
  }
  const hasPhoto = topics.some((item) =>
    item.clips.some((c) => c.thumbnail && !failed.has(c.thumbnail)),
  );
  return (
    <main
      ref={scene}
      className={s.scene}
      data-testid="discovery-scene"
      data-transition={movingBetween}
      data-dragging={dragging}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !showModal && selectedIndex >= 0) {
          event.preventDefault();
          back();
        }
      }}
    >
      <div
        className={s.horizon}
        aria-hidden="true"
        data-testid="scene-horizon"
        style={{
          transform: `translate3d(${camera.x * 0.075}px,${camera.y * 0.055}px,0) scale(1.09)`,
        }}
      />
      <div className={s.shade} aria-hidden="true" />
      <header className={s.header}>
        <div className={s.identity}>
          <span className={s.mark}>
            <Icon name="atlas" size={31} />
          </span>
          <span>Outlandish</span>
        </div>
        <div className={s.topActions}>
          {accountAction && <div className={s.account}>{accountAction}</div>}
          {brief.mode === "preview" && (
            <span className={s.preview} data-testid="preview-label">
              <i />
              Design preview
            </span>
          )}
          {topics.length > 0 && (
            <button
              className={s.indexControl}
              type="button"
              aria-label="Topic index"
              onClick={(e) =>
                navigate(
                  { ...nav, overlay: "index" },
                  cameraRef.current,
                  e.currentTarget,
                )
              }
            >
              <Icon name="list" size={16} />
              <span>Index</span>
            </button>
          )}
        </div>
      </header>
      <section className={s.heading} aria-label="Weekly discovery">
        <div className={s.headingRule} aria-hidden="true" />
        <div>
          <h1>Discovery atlas</h1>
          <p>
            {period
              ? `Week of ${period}`
              : brief.mode === "preview"
                ? "Spatial interaction study"
                : "Weekly product intelligence"}
          </p>
        </div>
      </section>
      <div
        className={s.world}
        ref={world}
        data-testid="scene-world"
        data-mode={selectedIndex < 0 ? "overview" : "topic"}
        aria-label="Opportunity landscape"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancelGesture}
        onPointerLeave={(event) => {
          if (gesture.current && !gesture.current.moved) cancelGesture(event);
        }}
        onClickCapture={(e) => {
          if (suppress.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
            suppress.current = false;
          }
        }}
      >
        {topics.map((item, ti) => {
          const active = ti === selectedIndex;
          const inactive = selectedIndex >= 0 && !active;
          const group = anchor(ti, viewport, topics.length);
          const allVisible = item.clips.filter(
            (c) => c.thumbnail && !failed.has(c.thumbnail),
          );
          const visible = active ? allVisible : allVisible.slice(0, 5);
          const labelX = group.x + camera.x * group.depth;
          const labelY = group.y + group.size * 0.856 + camera.y * group.depth;
          return (
            <div
              className={s.cluster}
              data-active={active}
              data-inactive={inactive}
              key={item.id}
            >
              {visible.map((post, ci) => {
                const p = clipPlacement(
                  ti,
                  ci,
                  topics.length,
                  viewport,
                  camera,
                  selectedIndex < 0 ? null : selectedIndex,
                  active ? centerClip : 0,
                  visible.length,
                );
                return (
                  <button
                    type="button"
                    className={s.clip}
                    key={post.id}
                    tabIndex={inactive ? -1 : 0}
                    disabled={inactive}
                    data-testid="scene-clip"
                    data-topic-id={item.id}
                    data-post-id={post.id}
                    data-depth={p.depth.toFixed(3)}
                    data-active-clip={active && ci === 0 ? "first" : undefined}
                    aria-label={`Inspect ${post.title}`}
                    style={{
                      width: p.width,
                      zIndex: p.z,
                      transform: `translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%) rotate(${p.angle}deg)`,
                    }}
                    onClick={(e) => inspect(item, post.id, e.currentTarget)}
                  >
                    <img
                      src={post.thumbnail!}
                      referrerPolicy="no-referrer"
                      alt=""
                      draggable={false}
                      onError={() => imageFailed(post.thumbnail!)}
                    />
                    {post.platform === "sample" ? (
                      (post.playbackUrl || post.embedUrl) && (
                        <span className={s.playGlyph} aria-hidden="true">
                          <Icon name="play" size={13} />
                        </span>
                      )
                    ) : (
                      <span className={s.clipChrome}>
                        <MediaIcon clip={post} size={15} />
                        <span>{platformLabel(post)}</span>
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                className={s.label}
                hidden={active}
                disabled={inactive || active}
                data-primary={ti === 0}
                tabIndex={inactive || active ? -1 : 0}
                data-testid="scene-topic"
                data-topic-id={item.id}
                aria-label={`Explore ${item.topic}`}
                style={{
                  zIndex: 45,
                  transform: `translate3d(${labelX}px,${labelY}px,0) translateX(-50%)`,
                }}
                onClick={(e) => focusTopic(item, e.currentTarget)}
              >
                <span className={s.labelText}>
                  {item.category && <small>{item.category}</small>}
                  <strong>{item.topic}</strong>
                </span>
                <span className={s.roundArrow}>
                  <Icon name="arrow" size={15} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {!topics.length && (
        <div className={s.empty}>
          <h2>{brief.publishedAt ? "No clips available this week" : "No published opportunities yet"}</h2>
          <p>{brief.coverage}</p>
          {showPreviewLink && !brief.publishedAt && <a href="/preview" className={s.previewLink}>Explore the design preview <Icon name="arrow" size={16} /></a>}
        </div>
      )}
      {topics.length > 0 && !hasPhoto && selectedIndex < 0 && (
        <button
          type="button"
          className={s.noMedia}
          onClick={(e) =>
            navigate(
              { ...nav, overlay: "index" },
              cameraRef.current,
              e.currentTarget,
            )
          }
        >
          Previews unavailable · Browse topic index{" "}
          <Icon name="arrow" size={16} />
        </button>
      )}
      {topic && !inspecting && (
        <div className={s.topicCaption}>
          <button
            className={s.back}
            type="button"
            data-testid="scene-back"
            onClick={back}
          >
            <Icon name="back" size={14} />
            Overview
          </button>
          <h2>{topic.topic}</h2>
          <p>{topic.finding}</p>
          {topic.clips.length > 0 &&
            !topic.clips.some(
              (c) => c.thumbnail && !failed.has(c.thumbnail),
            ) && (
              <button
                type="button"
                className={s.textButton}
                onClick={(e) =>
                  inspect(topic, topic.clips[0].id, e.currentTarget)
                }
              >
                Inspect evidence <Icon name="arrow" size={14} />
              </button>
            )}
        </div>
      )}
      <footer className={s.footer}>
        {topics.length > 0 ? (
          <span className={s.hint}>
            <Icon name={topic ? "photo" : "drag"} size={17} />
            {topic ? "Select a clip" : "Drag to explore"}
          </span>
        ) : (
          <span />
        )}
        {topics.length > 0 && (
          <nav className={s.miniMap} aria-label="Opportunity navigator">
            {topics.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Focus ${item.topic}`}
                title={item.topic}
                aria-current={topic?.id === item.id ? "true" : undefined}
                style={{
                  order:
                    topics.length > 1 ? ([1, 0, 2][index] ?? index) : index,
                }}
                onClick={(e) => focusTopic(item, e.currentTarget, !!topic)}
              >
                <i />
              </button>
            ))}
          </nav>
        )}
        <button
          className={s.coverage}
          type="button"
          onClick={(e) =>
            navigate(
              { ...nav, overlay: "coverage" },
              cameraRef.current,
              e.currentTarget,
            )
          }
        >
          <Icon name="info" size={16} />
          Coverage
        </button>
      </footer>
      {topic && !showModal && focusedMedia.length > 1 && (
        <nav className={s.topicSteps} aria-label="Browse topic clips">
          <button
            type="button"
            aria-label="Previous clip"
            onClick={() => stepClip(-1)}
          >
            <Icon name="back" />
          </button>
          <span aria-live="polite">
            {centerClip + 1} / {focusedMedia.length}
          </span>
          <button
            type="button"
            aria-label="Next clip"
            onClick={() => stepClip(1)}
          >
            <Icon name="next" />
          </button>
        </nav>
      )}
      <dialog
        ref={modal}
        className={s.dialog}
        data-kind={inspecting ? "evidence" : "sheet"}
        aria-label={
          inspecting
            ? "Clip evidence"
            : nav.overlay === "index"
              ? "Topic index"
              : "Coverage"
        }
        onCancel={(e) => {
          e.preventDefault();
          back();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) back();
        }}
      >
        {showModal && (
          <div className={s.dialogPage}>
            <div className={s.dialogTop}>
              <div className={s.dialogBrand}>
                <Icon name="atlas" size={22} />{" "}
                {inspecting
                  ? "Clip evidence"
                  : nav.overlay === "index"
                    ? "Topic index"
                    : "Coverage"}
              </div>
              <button
                type="button"
                autoFocus
                className={s.close}
                data-testid={inspecting ? "close-evidence" : "close-overlay"}
                aria-label={inspecting ? "Close evidence" : "Close panel"}
                onClick={back}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            {inspecting && (
              <Evidence
                key={clip.id}
                brief={brief}
                topic={topic}
                clip={clip}
                from={triggerRect.current}
                onChangeClip={(id) => {
                  triggerRect.current = null;
                  navigate(
                    { ...nav, clipId: id },
                    cameraRef.current,
                    undefined,
                    true,
                  );
                }}
              />
            )}
            {nav.overlay === "index" && (
              <div className={s.sheetBody}>
                <h2>Topic index</h2>
                {period && <p>{period}</p>}
                <ol className={s.indexList}>
                  {topics.map((item) => (
                    <li key={item.id}>
                      <button
                        data-testid="index-topic"
                        data-topic-id={item.id}
                        type="button"
                        onClick={(e) => focusTopic(item, e.currentTarget, true)}
                      >
                        <span>
                          <small>{item.category || "Opportunity"}</small>
                          <strong>{item.topic}</strong>
                          <span>{item.finding}</span>
                        </span>
                        <Icon name="arrow" size={20} />
                      </button>
                      <ul>
                        {item.clips.map((post) => (
                          <li key={post.id}>
                            <button
                              type="button"
                              onClick={(e) =>
                                inspect(item, post.id, e.currentTarget)
                              }
                            >
                              <MediaIcon clip={post} size={14} />
                              <span>{post.title}</span>
                              <Icon name="next" size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {nav.overlay === "coverage" && (
              <div className={s.sheetBody}>
                <h2>Coverage</h2>
                <p>{brief.coverage}</p>
                <dl className={s.coverageList}>
                  <dt>Source</dt>
                  <dd>
                    {brief.mode === "preview"
                      ? "Design preview materials"
                      : "Reviewed weekly brief"}
                  </dd>
                  {period && (
                    <>
                      <dt>Reporting week</dt>
                      <dd>{period}</dd>
                    </>
                  )}
                  {stamp(brief.collectedAt) && (
                    <>
                      <dt>Last collection</dt>
                      <dd>{stamp(brief.collectedAt)}</dd>
                    </>
                  )}
                  {stamp(brief.publishedAt) && (
                    <>
                      <dt>Published</dt>
                      <dd>{stamp(brief.publishedAt)}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}
      </dialog>
    </main>
  );
}
