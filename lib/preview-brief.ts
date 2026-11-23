import type { SceneBrief, SceneClip } from "@/components/scene/types";

function stock(
  id: string, title: string, credit: string, sourcePath: string, film = false,
): SceneClip {
  return {
    id,
    title,
    platform: "sample",
    handle: credit,
    thumbnail: "/discovery-media/" + id + ".webp",
    sourceUrl: "https://www.pexels.com/" + sourcePath + "/",
    playbackUrl: film ? "/discovery-media/" + id + ".mp4" : null,
    commentCoverage: "Licensed visual study. Shopper comments were not collected.",
  };
}

export const previewBrief: SceneBrief = {
  mode: "preview",
  weekStart: null,
  weekEnd: null,
  coverage: "Interaction preview with licensed films and photographs. No social collection has been run for this preview.",
  opportunities: [
    {
      id: "preview-coffee", topic: "Pour-over drippers", category: "Coffee",
      finding: "Follow the pour from the kettle to the filter.",
      clips: [
        stock("coffee-motion", "Brewing a pour-over", "khezez", "video/barista-preparing-pour-over-coffee-indoors-32653816", true),
        stock("pour-one", "The copper kettle", "Esra Erdem", "photo/man-pouring-water-in-coffee-dripper-19723754"),
        stock("coffee-filter", "Setting the filter", "Cup of Couple", "photo/a-person-making-pour-over-coffee-7658114"),
        stock("coffee-bloom", "Water meets coffee", "Ahmed", "photo/close-up-of-pouring-water-to-coffee-18199411"),
      ],
    },
    {
      id: "preview-cameras", topic: "Film cameras", category: "Photography",
      finding: "Look inside a camera as a fresh roll goes in.",
      clips: [
        stock("film-motion", "Loading a roll of film", "Esra Afşar", "video/loading-film-into-a-vintage-camera-30850652", true),
        stock("film-load", "Threading the film", "Beyzaa Yurtkuran", "photo/hands-putting-photographic-film-in-to-camera-15948695"),
        stock("film-body", "The open camera body", "Vinh Võ", "photo/hands-holding-analogue-camera-with-film-16154738"),
      ],
    },
    {
      id: "preview-lanterns", topic: "Camp lanterns", category: "Outdoors",
      finding: "Explore lanterns in the woods and at the tent door.",
      clips: [
        stock("camp-motion", "A lantern in the forest", "Uriel Mont", "video/close-up-video-of-a-lantern-6263310", true),
        stock("camp-tent", "At the tent entrance", "Buğra Özcan", "photo/lamp-on-tent-on-camping-22669473"),
        stock("camp-flame", "Light in the undergrowth", "Pexels", "photo/vintage-lantern-illuminating-in-forest-31961673"),
        stock("camp-trail", "The lantern at twilight", "Pexels", "photo/camping-lamp-hanging-on-stick-26611510"),
      ],
    },
  ],
};
