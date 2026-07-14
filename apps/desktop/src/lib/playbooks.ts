export type PlaybookCategory =
  "Find customers" | "Content" | "Search" | "Conversion" | "Research";

export interface IntegrationDependency {
  domain: string;
  label: string;
  access: "connected" | "public";
  note?: string;
}

export interface Playbook {
  id: string;
  title: string;
  summary: string;
  task: string;
  agentId: string;
  categories: PlaybookCategory[];
  integrations: IntegrationDependency[];
  goal: string;
  inputs: string[];
  workflow: string[];
  deliverables: string[];
  accessNotes: string[];
  guardrails: string[];
}

export const PLAYBOOK_CATEGORIES: PlaybookCategory[] = [
  "Find customers",
  "Content",
  "Search",
  "Conversion",
  "Research",
];

export const INTEGRATIONS = {
  analytics: {
    domain: "analytics.googleapis.com",
    label: "Google Analytics",
    access: "connected",
  },
  posthog: { domain: "posthog.com", label: "PostHog", access: "connected" },
  reddit: { domain: "reddit.com", label: "Reddit", access: "public" },
  hackerNews: {
    domain: "news.ycombinator.com",
    label: "Hacker News",
    access: "public",
  },
  x: { domain: "x.com", label: "X", access: "public" },
  linkedin: { domain: "linkedin.com", label: "LinkedIn", access: "public" },
  facebook: {
    domain: "facebook.com",
    label: "Facebook",
    access: "connected",
    note: "Page and approved public-content access only",
  },
  instagram: {
    domain: "instagram.com",
    label: "Instagram",
    access: "connected",
    note: "Professional-account comments, mentions, hashtags, and insights",
  },
  tiktok: {
    domain: "tiktok.com",
    label: "TikTok",
    access: "connected",
    note: "Owned-account data; broad public research requires separate eligibility",
  },
  youtube: { domain: "youtube.com", label: "YouTube", access: "connected" },
  gmail: {
    domain: "gmail.googleapis.com",
    label: "Gmail",
    access: "connected",
  },
  hubspot: { domain: "api.hubapi.com", label: "HubSpot", access: "connected" },
  productHunt: {
    domain: "api.producthunt.com",
    label: "Product Hunt",
    access: "public",
  },
  searchConsole: {
    domain: "searchconsole.googleapis.com",
    label: "Google Search Console",
    access: "connected",
  },
  semrush: { domain: "semrush.com", label: "Semrush", access: "connected" },
  openai: { domain: "openai.com", label: "OpenAI", access: "connected" },
  perplexity: {
    domain: "perplexity.ai",
    label: "Perplexity",
    access: "connected",
  },
  anthropic: {
    domain: "anthropic.com",
    label: "Anthropic",
    access: "connected",
  },
  googleAds: {
    domain: "googleads.googleapis.com",
    label: "Google Ads",
    access: "connected",
  },
  meta: {
    domain: "graph.facebook.com",
    label: "Meta Ads",
    access: "connected",
  },
  linkedInAds: {
    domain: "linkedin.com",
    label: "LinkedIn Ads",
    access: "connected",
  },
  tiktokAds: {
    domain: "ads.tiktok.com",
    label: "TikTok Ads",
    access: "connected",
  },
} satisfies Record<string, IntegrationDependency>;

const sharedGuardrails = [
  "Use evidence from connected sources. Label assumptions and data gaps clearly.",
  "Never imply a platform was searched comprehensively when access is limited to owned accounts, approved endpoints, or visible public pages.",
  "Do not publish, send messages, change spend, or edit external records without approval.",
  "Prefer a few high-confidence findings over a long list of generic suggestions.",
];

export const PLAYBOOKS: Playbook[] = [
  {
    id: "growth-brief",
    title: "Growth report",
    summary: "Changes, causes, and next steps.",
    task: "Compile a growth report from our connected analytics: what changed, why it matters, and the next action for each insight.",
    agentId: "analyst",
    categories: ["Conversion"],
    integrations: [INTEGRATIONS.analytics, INTEGRATIONS.posthog],
    goal: "Turn recent acquisition and product usage data into a short weekly decision brief.",
    inputs: [
      "A defined reporting window and comparison period.",
      "At least one current analytics source with dated metrics.",
      "The conversion or business outcome the report should optimize for.",
    ],
    workflow: [
      "Compare the latest complete period with the previous equivalent period.",
      "Find the largest meaningful changes, then check whether channel, page, campaign, or product data explains them.",
      "Separate observed evidence from likely explanations.",
      "Choose one practical next action for every reported insight.",
    ],
    deliverables: [
      "A concise executive summary.",
      "Up to three evidence-backed insights with what changed, why it matters, and the next action.",
      "Charts or tables for the comparisons that materially support the analysis.",
      "A short data-quality note covering unavailable or stale sources.",
    ],
    accessNotes: [
      "Use Google Analytics for acquisition and site behavior, then PostHog for product events when both are connected.",
      "If only a cached or single-metric snapshot exists, report that limitation and avoid causal claims.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "buying-signals",
    title: "Find buying signals",
    summary: "People actively describing the problem you solve.",
    task: "Find new public conversations where people in our ideal customer profile are actively describing the problem we solve. Save only strong matches with the source, evidence, and a useful reply or outreach angle for my review.",
    agentId: "prospector",
    categories: ["Find customers"],
    integrations: [
      INTEGRATIONS.reddit,
      INTEGRATIONS.x,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
    ],
    goal: "Surface people and companies with a timely, observable reason to consider the product.",
    inputs: [
      "An ideal customer profile with exclusions, geography, and business type.",
      "Concrete problem phrases, alternatives, and high-intent behaviors.",
      "A recency window and minimum evidence threshold.",
    ],
    workflow: [
      "Translate the ideal customer profile into concrete pain, intent, and timing signals.",
      "Search each available channel separately using language and formats native to that community.",
      "On Facebook and Instagram, prioritize connected Page or professional-account comments, mentions, hashtags, and approved public Page data.",
      "On TikTok, use connected-account comments and videos unless eligible public-research access is explicitly available.",
      "Reject vague matches, stale posts, recruiters, competitors, and unsupported guesses.",
      "Rank qualified signals by fit, urgency, and how naturally the product can help.",
    ],
    deliverables: [
      "A table of qualified people or companies with source links and quoted evidence.",
      "The signal, fit rationale, confidence, and recommended next step for each match.",
      "A value-first reply or outreach angle for review, never an automatically sent message.",
    ],
    accessNotes: [
      "Reddit, X, and accessible public web results can support broad discovery, subject to their terms and available tools.",
      "Meta APIs do not provide unrestricted search across personal Facebook or Instagram accounts.",
      "TikTok commercial integrations normally expose the authorized account; broad public-content querying is restricted to approved research use cases.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "social-account-setup",
    title: "Set up social accounts",
    summary: "Find a consistent handle and prepare each profile.",
    task: "Find a distinctive, brand-aligned social handle we can use consistently, verify the strongest options across our priority platforms, and prepare the accounts for setup. Do not claim a handle or create an account without my approval.",
    agentId: "prospector",
    categories: ["Research"],
    integrations: [
      INTEGRATIONS.x,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.youtube,
      INTEGRATIONS.facebook,
    ],
    goal: "Secure a recognizable social identity without forcing the brand into a weak platform-specific variation.",
    inputs: [
      "The brand name, website, positioning, and words the handle should avoid.",
      "Priority platforms and any existing accounts that must be preserved.",
      "The preferred balance between a short brand handle and a descriptive fallback.",
    ],
    workflow: [
      "Generate a small set of pronounceable handles that feel native to the brand, then reject generic suffixes and confusing spellings.",
      "Check the exact profile URL and platform search for every candidate on each priority network.",
      "Treat a missing profile only as an availability signal. Confirm availability in the platform signup flow before recommending a claim.",
      "Rank candidates by cross-platform consistency, memorability, pronunciation, and collision risk.",
      "Prepare the chosen display name, bio, website link, avatar, and recovery checklist for each platform.",
      "Hand account creation or an unavailable credential to the Setup agent, preserving the approved handle and profile details.",
    ],
    deliverables: [
      "A cross-platform availability matrix with evidence links and the time checked.",
      "One lead handle, two fallbacks, and a concise reason for the ranking.",
      "A platform-by-platform setup checklist with consistent profile copy.",
      "A clear approval step before any account is created or handle is claimed.",
    ],
    accessNotes: [
      "Public profile pages can indicate that a handle is unused, but only the platform signup flow can confirm it is claimable.",
      "Creating accounts may require the user's login, email or phone verification, CAPTCHA, or acceptance of platform terms.",
    ],
    guardrails: [
      ...sharedGuardrails,
      "Never create an account, accept terms, reserve a handle, or change an existing profile without explicit approval.",
      "Do not call a handle available solely because a public profile returns not found.",
    ],
  },
  {
    id: "founder-content",
    title: "Founder content",
    summary: "Draft useful posts from real customer signals.",
    task: "Turn recent customer questions, product changes, analytics, and market signals into concise founder-led posts in our voice. Save the strongest drafts for my review and avoid generic advice.",
    agentId: "content",
    categories: ["Content"],
    integrations: [
      INTEGRATIONS.analytics,
      INTEGRATIONS.x,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
      INTEGRATIONS.youtube,
    ],
    goal: "Create founder-led content grounded in what the company is actually learning and building.",
    inputs: [
      "A saved founder or brand voice with examples of acceptable claims.",
      "Recent product changes, customer questions, or measured outcomes.",
      "The channels and audience segments the founder actually wants to reach.",
    ],
    workflow: [
      "Collect recent product changes, customer language, objections, and performance signals.",
      "Choose ideas with a useful point of view, proof, and a clear audience.",
      "Choose the right treatment for each channel: written insight, carousel outline, short-video script, or longer demonstration.",
      "Draft channel-native posts in the saved brand voice, including Instagram, TikTok, or YouTube only when the idea benefits from a visual treatment.",
      "Rank drafts by usefulness and likelihood of earning the right audience's attention.",
    ],
    deliverables: [
      "Two or three polished post drafts with hooks and intended channels.",
      "The source insight behind each draft and why it is timely.",
      "A recommended lead draft for review.",
    ],
    accessNotes: [
      "Analytics informs which ideas resonated; connected social accounts provide owned-content performance and audience responses.",
      "A destination channel is optional. The agent can still draft for review without publishing access.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "conversion-review",
    title: "Conversion review",
    summary: "Find the biggest leak in the current funnel.",
    task: "Review our connected acquisition and conversion data, identify the single clearest funnel leak, explain the evidence, and propose one specific experiment with a measurable success condition.",
    agentId: "analyst",
    categories: ["Conversion"],
    integrations: [INTEGRATIONS.analytics, INTEGRATIONS.posthog],
    goal: "Identify the highest-leverage measurable obstacle between attention and conversion.",
    inputs: [
      "Named funnel stages with event or page definitions.",
      "A meaningful date range and enough volume to compare.",
      "The primary conversion and any known tracking changes.",
    ],
    workflow: [
      "Map the observable funnel stages and verify the available event definitions.",
      "Compare stage conversion rates by period and useful segment.",
      "Locate the largest credible leak and rule out tracking problems.",
      "Design the smallest experiment that can test the proposed explanation.",
    ],
    deliverables: [
      "A funnel table or chart.",
      "One prioritized leak with evidence and business impact.",
      "One experiment with owner, change, metric, and success threshold.",
    ],
    accessNotes: [
      "Google Analytics can establish acquisition and page-level movement; PostHog can validate product-event progression.",
      "If event coverage or sample size is insufficient, the output should be a tracking diagnosis rather than a conversion recommendation.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "community-opportunities",
    title: "Community opportunities",
    summary: "Relevant Reddit, Hacker News, and forum threads.",
    task: "Monitor the communities where our ideal customers spend time. Find high-intent questions we can genuinely help with, save the best opportunities, and draft value-first replies that respect each community's norms.",
    agentId: "prospector",
    categories: ["Find customers"],
    integrations: [
      INTEGRATIONS.reddit,
      INTEGRATIONS.hackerNews,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
    ],
    goal: "Find active community discussions where useful participation can build trust or create a qualified conversation.",
    inputs: [
      "A list of communities, accounts, creators, or topics where buyers spend time.",
      "Community-specific promotion rules and disallowed behaviors.",
      "A clear definition of what the company can credibly help with.",
    ],
    workflow: [
      "Search recent discussions, connected account comments, and approved public surfaces for concrete questions, pain, comparisons, and requests for recommendations.",
      "Check thread recency, engagement, author fit, and community self-promotion rules.",
      "Keep only threads where the company can add specific value without forcing a pitch.",
      "Draft a useful reply that answers the question before mentioning the product, if mentioning it is appropriate at all.",
    ],
    deliverables: [
      "A prioritized table of threads with links, community, intent signal, and fit.",
      "A draft reply and participation note for every selected thread.",
      "A clear skip reason for tempting but inappropriate opportunities.",
    ],
    accessNotes: [
      "Facebook Groups and private communities are included only when the user has authorized access and platform rules allow it.",
      "Instagram and TikTok are strongest here for comments, mentions, and questions around connected professional or creator accounts, not unrestricted network-wide search.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "prospect-triggers",
    title: "Prospect triggers",
    summary: "Job changes, launches, and timely reasons to reach out.",
    task: "Find timely public triggers among ideal prospects, such as a launch, new role, hiring signal, product change, or stated pain. Save qualified matches with the evidence and a direct, relevant outreach angle.",
    agentId: "prospector",
    categories: ["Find customers"],
    integrations: [
      INTEGRATIONS.linkedin,
      INTEGRATIONS.x,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
    ],
    goal: "Detect recent events that create a credible reason for a relevant sales conversation now.",
    inputs: [
      "A target-account or ideal-customer definition.",
      "The trigger types that materially change buying likelihood.",
      "A maximum trigger age and a clear exclusion list.",
    ],
    workflow: [
      "Review target accounts, company Pages, professional profiles, creator updates, and public posts for launches, hiring, role changes, new initiatives, and explicit pain.",
      "Verify that each trigger is recent and connected to a problem the product solves.",
      "Score account fit, trigger strength, and timing.",
      "Develop a direct outreach angle tied to the observed event.",
    ],
    deliverables: [
      "A qualified trigger table with company, person, source, date, and evidence.",
      "Fit and timing scores with a recommended next step.",
      "A concise outreach angle for review.",
    ],
    accessNotes: [
      "Use first-party company and creator posts as evidence, not inferred personal data.",
      "Facebook, Instagram, and TikTok coverage depends on connected or otherwise approved access and may be incomplete.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "content-repurpose",
    title: "Reuse what worked",
    summary: "Turn proven material into new channel-native drafts.",
    task: "Review our strongest recent content and customer conversations. Rework the best ideas into new channel-native drafts without repeating the original wording, and save them for review.",
    agentId: "content",
    categories: ["Content"],
    integrations: [
      INTEGRATIONS.x,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
      INTEGRATIONS.youtube,
    ],
    goal: "Extend the useful life of proven ideas while making every new draft native to its destination.",
    inputs: [
      "Source material with an observable performance or customer-quality signal.",
      "The permitted destination channels and available production formats.",
      "Brand voice and any claims that require fresh verification.",
    ],
    workflow: [
      "Identify source material with strong engagement, conversion, or customer resonance.",
      "Extract the durable insight rather than copying the original wording.",
      "Choose formats and channels that suit the idea, such as an X thread, LinkedIn post, Instagram carousel, TikTok script, or YouTube outline.",
      "Draft fresh versions with the right length, hook, and call to action for each channel.",
    ],
    deliverables: [
      "A source-to-draft map explaining what was reused and why.",
      "Channel-native drafts ready for review.",
      "A recommended publishing order.",
    ],
    accessNotes: [
      "Connected channel analytics improve source selection, but the playbook can work from user-provided source material.",
      "Do not treat engagement across different networks as directly comparable without normalizing for reach and format.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "customer-questions",
    title: "Answer customer questions",
    summary: "Build content from the questions buyers keep asking.",
    task: "Collect recurring questions and objections from connected conversations, communities, search signals, and prospect notes. Draft clear answers that can become posts, help content, or sales material, and save the best drafts.",
    agentId: "content",
    categories: ["Content", "Research"],
    integrations: [
      INTEGRATIONS.gmail,
      INTEGRATIONS.hubspot,
      INTEGRATIONS.reddit,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
    ],
    goal: "Turn repeated buyer confusion and objections into reusable, evidence-backed answers.",
    inputs: [
      "Customer-facing conversations or notes with permission to analyze them.",
      "A product truth source for validating answers and claims.",
      "The intended output surfaces, such as help, sales, social, or website copy.",
    ],
    workflow: [
      "Collect recent questions and objections from customer-facing sources.",
      "Cluster duplicates while preserving the customer's original language.",
      "Prioritize by frequency, purchase impact, and answerability.",
      "Draft direct answers and recommend the best format for each one.",
    ],
    deliverables: [
      "A ranked question and objection catalogue with source evidence.",
      "Draft answers for the highest-value themes.",
      "Recommended uses across content, help, and sales enablement.",
    ],
    accessNotes: [
      "CRM and email provide direct customer evidence; social comments add public questions and objections where access permits.",
      "Remove personal information from the output and quote private conversations only when the user has explicitly allowed it.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "launch-cycle",
    title: "Keep the launch alive",
    summary:
      "Plan the next launch angle instead of treating launch as one day.",
    task: "Review recent product changes, previous launch material, and audience response. Build the next focused launch angle with a clear hook, proof, channel plan, and the drafts needed for my review.",
    agentId: "content",
    categories: ["Content"],
    integrations: [
      INTEGRATIONS.x,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
      INTEGRATIONS.youtube,
      INTEGRATIONS.productHunt,
    ],
    goal: "Create a repeatable sequence of launch moments around real product value and audience response.",
    inputs: [
      "A shipped product change with verified availability and claims.",
      "The launch audience, desired action, and proof available today.",
      "Prior launch assets and response data when available.",
    ],
    workflow: [
      "Review shipped changes, customer outcomes, previous messaging, and response data.",
      "Choose one audience and one fresh value angle.",
      "Build proof, hook, and a channel sequence that assigns a distinct job to text, carousel, short video, demo, and launch-directory formats.",
      "Draft the core launch assets and follow-up posts.",
    ],
    deliverables: [
      "A focused launch brief with audience, promise, proof, and hook.",
      "A short channel sequence and publishing cadence.",
      "Draft launch assets for review.",
    ],
    accessNotes: [
      "Channel connections provide owned-performance context and may later support approved publishing, but are not required to produce drafts.",
      "Do not promise availability, integrations, or customer outcomes that have not been verified.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "seo-opportunities",
    title: "Search opportunities",
    summary: "Queries and pages with a realistic path to traffic.",
    task: "Find high-intent search opportunities relevant to our product and current authority. Prioritize realistic queries, identify the page or content needed, and save a concise brief for the strongest opportunity.",
    agentId: "cmo",
    categories: ["Search"],
    integrations: [
      INTEGRATIONS.searchConsole,
      INTEGRATIONS.semrush,
      INTEGRATIONS.analytics,
    ],
    goal: "Find search demand the company can credibly satisfy and convert.",
    inputs: [
      "A verified website property and target market.",
      "Current product positioning and conversion goals.",
      "Search Console history or a credible third-party demand source.",
    ],
    workflow: [
      "Review current queries, landing pages, rankings, and relevant competitor coverage.",
      "Group opportunities by search intent and product relevance.",
      "Estimate difficulty using current authority and the quality of competing results.",
      "Prioritize one opportunity and define the page required to win it.",
    ],
    deliverables: [
      "A ranked opportunity table with intent, evidence, difficulty, and business fit.",
      "A content brief for the strongest opportunity.",
      "A measurement plan covering impressions, clicks, and conversion.",
    ],
    accessNotes: [
      "Search Console supplies first-party query and page evidence; Semrush can extend competitor and demand coverage; Analytics validates downstream behavior.",
      "If the site is new or data is sparse, frame output as a hypothesis backlog rather than forecasted traffic.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "comparison-pages",
    title: "Comparison pages",
    summary: "Capture buyers comparing options in your category.",
    task: "Research how buyers compare products in our category. Identify one useful comparison or alternative page we can support honestly, then produce an evidence-based brief covering intent, structure, proof, and differentiation.",
    agentId: "cmo",
    categories: ["Search"],
    integrations: [
      INTEGRATIONS.searchConsole,
      INTEGRATIONS.semrush,
      INTEGRATIONS.reddit,
    ],
    goal: "Help evaluation-stage buyers understand genuine differences without producing thin or misleading competitor pages.",
    inputs: [
      "A named comparison set and the buyer segment making the decision.",
      "Verified product capabilities, pricing, and limitations.",
      "Evidence of comparison intent from search or customer discussions.",
    ],
    workflow: [
      "Find comparison and alternative queries used by relevant buyers.",
      "Review community discussions and current result pages for decision criteria.",
      "Identify an angle supported by verifiable product differences and customer needs.",
      "Build a fair page structure with proof and clear fit guidance.",
    ],
    deliverables: [
      "A chosen comparison opportunity and evidence for its intent.",
      "A detailed page brief with sections, claims, proof, and differentiation.",
      "A list of facts that must be verified before publication.",
    ],
    accessNotes: [
      "Search data establishes demand; community discussions reveal decision criteria but should not be treated as representative research by themselves.",
      "Competitor claims must be checked against current primary sources before publication.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "ai-search-visibility",
    title: "AI search visibility",
    summary: "Track whether assistants mention and understand the product.",
    task: "Check how our product and category appear across relevant AI search questions. Record where we are absent or misrepresented, identify the source content likely to improve the answer, and recommend one concrete update.",
    agentId: "cmo",
    categories: ["Search"],
    integrations: [
      INTEGRATIONS.openai,
      INTEGRATIONS.perplexity,
      INTEGRATIONS.anthropic,
    ],
    goal: "Understand how major assistants describe the category and whether the product appears accurately in buyer-relevant answers.",
    inputs: [
      "A stable question set representing discovery, comparison, and buying intent.",
      "Current product facts and canonical source pages.",
      "Access to at least two assistant or answer-engine surfaces for comparison.",
    ],
    workflow: [
      "Define representative discovery, comparison, and problem-aware questions.",
      "Run the same question set across available assistants and record citations.",
      "Compare mentions, accuracy, positioning, and source coverage.",
      "Identify the smallest source-content improvement likely to change future answers.",
    ],
    deliverables: [
      "A question-by-assistant visibility table.",
      "Important omissions or inaccuracies with supporting answer evidence.",
      "One prioritized source-content update and the rationale for it.",
    ],
    accessNotes: [
      "Run equivalent prompts in fresh sessions where possible and record model, date, citations, and personalization state.",
      "Assistant answers are samples, not rankings. Do not claim market-wide visibility from a small prompt set.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "backlink-opportunities",
    title: "Backlink opportunities",
    summary: "Relevant sites with a credible reason to reference you.",
    task: "Find credible backlink opportunities in our niche where our product, data, or expertise would genuinely improve an existing resource. Save only relevant opportunities with the page, contact path, and a non-spammy pitch angle.",
    agentId: "prospector",
    categories: ["Search", "Find customers"],
    integrations: [
      INTEGRATIONS.searchConsole,
      INTEGRATIONS.semrush,
      INTEGRATIONS.gmail,
    ],
    goal: "Find editorially credible link opportunities based on genuine usefulness, not volume outreach.",
    inputs: [
      "A target topic, market, and acceptable site-quality threshold.",
      "An asset, dataset, product capability, or expert point of view worth citing.",
      "Existing links and referring-domain data when available.",
    ],
    workflow: [
      "Review pages already ranking or linking in the target topic area.",
      "Find outdated, incomplete, or relevant resources the company can improve.",
      "Verify site quality, topical fit, contact path, and a specific reason to reference the company.",
      "Draft a concise pitch angle tied to the recipient's existing page.",
    ],
    deliverables: [
      "A prioritized opportunity table with page, site, fit, contact path, and rationale.",
      "The asset or expertise needed to earn each link.",
      "A tailored pitch draft for review.",
    ],
    accessNotes: [
      "Search and backlink tools identify candidates; Gmail is only for finding prior relationships or preparing reviewed outreach.",
      "Never send bulk outreach, invent a relationship, or recommend a link placement without a genuine editorial reason.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "campaign-watch",
    title: "Campaign watch",
    summary: "Spot spend or performance changes before they compound.",
    task: "Review connected campaign and conversion performance, flag material changes or wasted spend, explain the evidence, and recommend the smallest safe adjustment. Do not change budgets or campaigns without approval.",
    agentId: "ads",
    categories: ["Conversion"],
    integrations: [
      INTEGRATIONS.googleAds,
      INTEGRATIONS.meta,
      INTEGRATIONS.linkedInAds,
      INTEGRATIONS.tiktokAds,
      INTEGRATIONS.analytics,
    ],
    goal: "Detect material paid-media problems and opportunities early enough to act safely.",
    inputs: [
      "Connected ad accounts with currency, timezone, and attribution settings confirmed.",
      "The primary conversion, target efficiency, and minimum decision volume.",
      "Recent change history so the agent can separate expected learning from faults.",
    ],
    workflow: [
      "Compare recent spend, delivery, conversion, and efficiency against the previous period and targets.",
      "Check whether changes are isolated to a campaign, audience, creative, placement, or tracking issue.",
      "Prioritize by financial impact and confidence.",
      "Recommend the smallest reversible adjustment and its monitoring window.",
    ],
    deliverables: [
      "A campaign performance table with material changes highlighted.",
      "A short explanation of the highest-impact issue or opportunity.",
      "A proposed adjustment, expected effect, and approval requirement.",
    ],
    accessNotes: [
      "Compare Google, Meta, LinkedIn, and TikTok only where accounts are connected and conversion definitions are compatible.",
      "Platform-reported conversions and Analytics may use different attribution. Reconcile the difference before recommending spend changes.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "competitor-watch",
    title: "Watch competitors",
    summary: "Product, positioning, pricing, and channel changes.",
    task: "Track meaningful competitor changes across product, positioning, pricing, content, and distribution. Ignore routine noise and report only changes that create a risk or opportunity for us, with one recommended response.",
    agentId: "cmo",
    categories: ["Research"],
    integrations: [
      INTEGRATIONS.x,
      INTEGRATIONS.linkedin,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
      INTEGRATIONS.youtube,
      INTEGRATIONS.productHunt,
    ],
    goal: "Separate consequential competitive moves from routine activity and turn them into a useful response.",
    inputs: [
      "A maintained competitor and category-entrant list.",
      "The customer segments and buying criteria that matter to the company.",
      "A previous snapshot so the agent can distinguish changes from existing facts.",
    ],
    workflow: [
      "Monitor named competitors and category entrants across websites, product, pricing, positioning, hiring, launch directories, and available social or video channels.",
      "Verify each change against a primary source where possible.",
      "Assess which customer segment and buying criterion the move affects.",
      "Recommend whether to respond, learn, or ignore.",
    ],
    deliverables: [
      "A concise change log with source, date, and significance.",
      "The risk or opportunity created for the company.",
      "One recommended response for material changes only.",
    ],
    accessNotes: [
      "Social coverage varies by platform and account access. A missing post is not evidence that a competitor was inactive.",
      "Use primary pages, release notes, pricing pages, and direct posts before secondary commentary.",
    ],
    guardrails: sharedGuardrails,
  },
  {
    id: "customer-language",
    title: "Customer language",
    summary: "The phrases buyers use for problems and desired outcomes.",
    task: "Collect recent language used by customers and ideal prospects to describe their pain, alternatives, objections, and desired outcomes. Group repeated themes and recommend specific wording improvements for our marketing.",
    agentId: "cmo",
    categories: ["Research"],
    integrations: [
      INTEGRATIONS.hubspot,
      INTEGRATIONS.gmail,
      INTEGRATIONS.reddit,
      INTEGRATIONS.x,
      INTEGRATIONS.facebook,
      INTEGRATIONS.instagram,
      INTEGRATIONS.tiktok,
    ],
    goal: "Build a current voice-of-customer reference from the words buyers actually use.",
    inputs: [
      "A defined customer segment and buying stage.",
      "Recent customer-facing material with permission to analyze it.",
      "The marketing surfaces whose language should improve.",
    ],
    workflow: [
      "Collect recent verbatim language from customer conversations and public discussions.",
      "Tag statements by pain, trigger, alternative, objection, desired outcome, and proof.",
      "Cluster repeated phrases without smoothing away meaningful distinctions.",
      "Map the strongest language to specific marketing surfaces.",
    ],
    deliverables: [
      "A theme table with representative language and source context.",
      "Repeated phrases and important differences by segment or stage.",
      "Specific copy recommendations for priority marketing surfaces.",
    ],
    accessNotes: [
      "CRM and email are the strongest direct-customer sources; public social material broadens the sample but may overrepresent vocal users.",
      "Label every quote by source type and context, remove personal data, and never fabricate verbatim language.",
    ],
    guardrails: sharedGuardrails,
  },
];

export function playbookInstructions(playbook: Playbook) {
  const section = (title: string, items: string[]) =>
    `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}`;
  const services = playbook.integrations.map((item) => item.label);
  return [
    `# ${playbook.title}`,
    playbook.goal,
    section("Required inputs", playbook.inputs),
    section("Workflow", playbook.workflow),
    section("Deliverables", playbook.deliverables),
    section("Access and limitations", playbook.accessNotes),
    section("Guardrails", playbook.guardrails),
    `Owner: ${playbook.agentId}. Services: ${services.join(", ")}.`,
  ].join("\n\n");
}

export function playbookRunPrompt(playbook: Playbook) {
  return `Run the ${playbook.title} playbook for my brand.\n\n${playbookInstructions(playbook)}\n\nReturn the deliverables in this conversation. Do not publish or change external systems without my approval.`;
}

export function playbookSetupPrompt(playbook: Playbook) {
  const services = playbook.integrations
    .map(
      (integration) =>
        `- ${integration.label}: ${integration.access === "connected" ? "check and configure connection" : "verify an allowed read path"}${integration.note ? `; ${integration.note}` : ""}`,
    )
    .join("\n");
  return `Prepare the ${playbook.title} playbook for this workspace. Do not run the playbook yet.\n\nAudit these service requirements:\n${services}\n\nVerify the minimum useful read path for every service, reuse existing workspace credentials where safe, and configure only what this playbook actually needs. If the platform requires user consent, app review, or eligibility that cannot be completed automatically, explain the exact limitation and the smallest user action required. Never claim broad public coverage when access is limited to owned accounts or approved endpoints. Finish with a readiness summary: ready, usable with reduced coverage, or blocked.`;
}

export function getPlaybook(id: string | null | undefined) {
  return PLAYBOOKS.find((playbook) => playbook.id === id);
}
