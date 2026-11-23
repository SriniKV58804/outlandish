import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import s from "./Scene.module.css";
import type { SceneBrief, SceneClip, SceneOpportunity } from "./types";

export function platformLabel(clip: SceneClip) {
  return {
    tiktok: "TikTok",
    instagram: "Instagram",
    sample: clip.playbackUrl ? "Preview film" : "Study photograph",
  }[clip.platform];
}

export function MediaIcon({ clip, size }: { clip: SceneClip; size?: number }) {
  return (
    <Icon
      name={
        clip.platform === "sample"
          ? clip.playbackUrl
            ? "play"
            : "photo"
          : clip.platform
      }
      size={size}
    />
  );
}

function LinkOut({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size={15} />
    </a>
  );
}

export function Evidence({
  brief,
  topic,
  clip,
  from,
  onChangeClip,
}: {
  brief: SceneBrief;
  topic: SceneOpportunity;
  clip: SceneClip;
  from: DOMRect | null;
  onChangeClip: (id: string) => void;
}) {
  const hero = useRef<HTMLElement>(null);
  const [lostImage, setLostImage] = useState(false);
  const [lostPlayback, setLostPlayback] = useState(false);
  const [playEmbed, setPlayEmbed] = useState(false);
  let embed: string | null = null;
  if (clip.embedUrl && clip.sourceUrl) {
    try {
      const url = new URL(clip.embedUrl);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        ((clip.platform === "tiktok" &&
          url.hostname === "www.tiktok.com" &&
          /^\/player\/v1\/\d+\/?$/.test(url.pathname)) ||
          (clip.platform === "instagram" &&
            url.hostname === "www.instagram.com" &&
            /^\/reel\/[A-Za-z0-9_-]+\/embed\/?$/.test(url.pathname)))
      ) {
        embed = url.origin + url.pathname;
      }
    } catch {
      /* Invalid embed URLs leave the verified original-post action available. */
    }
  }
  const openedAt = useRef(from);

  useLayoutEffect(() => {
    const image = hero.current;
    const start = openedAt.current;
    if (
      !image ||
      !start ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // The parent opens the native dialog in its layout effect. Measure the final
    // media position only after that dialog has joined the top layer.
    let animation: Animation | undefined;
    const frame = requestAnimationFrame(() => {
      const end = image.getBoundingClientRect();
      if (!end.width || !end.height) return;
      const scale = Math.min(1, Math.max(0.14, start.width / end.width));
      const dx = start.left + start.width / 2 - end.left - end.width / 2;
      const dy = start.top + start.height / 2 - end.top - end.height / 2;
      animation = image.animate(
        [
          {
            transform: `translate(${dx}px,${dy}px) scale(${scale})`,
            opacity: 0.65,
          },
          { transform: "none", opacity: 1 },
        ],
        { duration: 400, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, []);

  const comments = clip.comments ?? [];
  return (
    <div className={s.evidenceGrid}>
      <div className={s.mediaColumn}>
        <figure className={s.inspectedMedia} ref={hero}>
          {embed && playEmbed ? (
            <iframe
              title={clip.title}
              src={embed}
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : clip.playbackUrl && !lostPlayback ? (
            <video
              key={clip.id}
              controls
              playsInline
              preload="none"
              poster={clip.thumbnail || undefined}
              onError={() => setLostPlayback(true)}
              src={clip.playbackUrl}
              aria-label={clip.title}
            />
          ) : clip.thumbnail && !lostImage ? (
            <img
              src={clip.thumbnail}
              alt={clip.title}
              referrerPolicy="no-referrer"
              onError={() => setLostImage(true)}
              draggable={false}
            />
          ) : (
            <div className={s.imageFallback}>
              <Icon name="photo" size={26} />
              <span>Preview unavailable</span>
            </div>
          )}
          {embed && !playEmbed && (!clip.playbackUrl || lostPlayback) && (
            <button
              type="button"
              className={s.embedPlay}
              onClick={() => setPlayEmbed(true)}
            >
              <Icon name="play" size={15} />
              Play clip
            </button>
          )}
        </figure>
        <div className={s.postCaption}>
          <strong>{clip.title}</strong>
          <span>
            <MediaIcon clip={clip} size={13} />
            {platformLabel(clip)}
            {clip.handle ? " · " + clip.handle : ""}
          </span>
        </div>
        {clip.sourceUrl && (
          <div className={s.sourceLink}>
            <LinkOut href={clip.sourceUrl}>
              Open{" "}
              {clip.platform === "sample"
                ? "original source"
                : `on ${platformLabel(clip)}`}
            </LinkOut>
          </div>
        )}
        {topic.clips.length > 1 && (
          <nav className={s.filmstrip} aria-label="Other clips in this topic">
            {topic.clips.map((post, index) => (
              <button
                type="button"
                key={post.id}
                aria-label={`Inspect ${post.title}`}
                aria-current={post.id === clip.id ? "true" : undefined}
                onClick={() => onChangeClip(post.id)}
              >
                {post.thumbnail ? (
                  <img
                    alt=""
                    src={post.thumbnail}
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <span>{index + 1}</span>
                )}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className={s.evidenceText}>
        <p className={s.eyebrow}>{topic.category || "Product opportunity"}</p>
        <h2>{topic.topic}</h2>
        <p className={s.intro}>{topic.finding}</p>
        <section>
          <h3>Shopper evidence</h3>
          {comments.length ? (
            comments.map((comment) => (
              <blockquote key={comment.id}>
                <p>“{comment.text}”</p>
                {comment.sourceUrl && (
                  <LinkOut href={comment.sourceUrl}>View source</LinkOut>
                )}
              </blockquote>
            ))
          ) : (
            <p>
              {clip.commentCoverage ||
                (brief.mode === "preview"
                  ? "This image study contains no shopper comments."
                  : "No verified shopper excerpt was retained for this clip.")}
            </p>
          )}
          {comments.length > 0 && clip.commentCoverage && (
            <p className={s.fine}>{clip.commentCoverage}</p>
          )}
        </section>
        {topic.prospect && (
          <section>
            <h3>Prospect</h3>
            <strong>{topic.prospect.brand}</strong>
            <p>{topic.prospect.fit}</p>
            <LinkOut href={topic.prospect.url}>{topic.prospect.name}</LinkOut>
            {topic.prospect.sizeBasis && (
              <p className={s.fine}>{topic.prospect.sizeBasis}</p>
            )}
          </section>
        )}
        {topic.pitch && (
          <section>
            <h3>{topic.pitch.format}</h3>
            <strong>{topic.pitch.idea}</strong>
            {topic.pitch.rationale && <p>{topic.pitch.rationale}</p>}
          </section>
        )}
        {topic.statistics?.length || topic.uncertainties?.length ? (
          <details className={s.notes}>
            <summary>Coverage and limitations</summary>
            {topic.statistics?.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {topic.uncertainties?.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </details>
        ) : null}
      </div>
    </div>
  );
}
