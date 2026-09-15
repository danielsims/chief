import { FaqList } from "./faq-list";

const faqs = [
  {
    question: "How is Chief different from a chat app?",
    answer:
      "Chief is a chat workspace for people and agents. You talk in channels the way you would in any team chat. Your agents sit in those same channels, pick up the work, and leave the files behind. They can run on a schedule, and they ask you before they do something big.",
  },
  {
    question: "Can they keep working after I close the laptop?",
    answer:
      "Yes. Close the laptop and they keep going. They can keep running on this computer, with your files, or they keep going in the cloud.",
  },
  {
    question: "What about my phone?",
    answer:
      "There’s an iPhone app. It’s the same workspace and the same channels as the Mac and Windows apps, so you can pick a thread up on your phone and keep going.",
  },
  {
    question: "Which apps can they use?",
    answer:
      "They connect to the tools the work already lives in. Google, Slack, GitHub, Notion, Linear, and the rest Chief starts you with. You can add more as you need them.",
  },
  {
    question: "Can I self host Chief?",
    answer:
      "Yes. You can host the relay, the agents, and the backend yourself, on your machine or on your own Cloudflare account. The desktop app is still the official client. The interface will be open source too.",
  },
  {
    question: "Is the Mac app free?",
    answer:
      "Yes. The Mac app is free while Chief is in beta. We’ll talk about pricing later.",
  },
];

export function LandingFaq() {
  return (
    <section className="pt-[132px] max-md:pt-[72px]" id="faq">
      <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
        <h2 className="text-foreground mx-auto mb-9 text-center text-[clamp(28px,3.4vw,40px)] leading-[1.12] font-medium tracking-[-0.045em] max-md:mb-5 max-md:text-[28px]">
          FAQs
        </h2>
        <FaqList items={faqs} />
      </div>
    </section>
  );
}
