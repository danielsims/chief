import Image from "next/image";
import Link from "next/link";

import { DownloadButton } from "./download-button";
import { SiteHeader } from "./site-header";

export function LandingHero() {
  return (
    <section className="bg-background relative pb-[88px] max-md:pb-12">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 bottom-[260px] bg-[linear-gradient(#003b9733,#00255322),url('/landing/colour-print.png')] bg-cover bg-[center_62%] max-lg:bottom-[180px] max-md:bottom-[110px]"
      />

      <SiteHeader overlay />

      <div className="relative z-10 px-6 pt-[65px] pb-16 text-center text-white max-md:px-[6%] max-md:pt-10 max-md:pb-10">
        <h1 className="m-0 text-[clamp(45px,5.2vw,76px)] leading-[1.04] font-medium tracking-[-0.05em] max-md:text-[clamp(35px,8.5vw,52px)]">
          Your team of agents,
          <br />
          already at work.
        </h1>
        <p className="mx-auto mt-7 max-w-[690px] text-lg leading-[1.65] text-white max-md:mt-[22px] max-md:text-base">
          Give Chief a task. Your agents research, write and build together.
          <br className="max-md:hidden" /> Follow the work on your desktop. Pick
          it up on your phone.
        </p>
        <div className="relative z-[6] mt-7 flex flex-wrap items-center justify-center gap-[30px] max-md:gap-5">
          <DownloadButton />
          <Link
            className="inline-flex items-center gap-[25px] text-[15px] font-medium text-white max-md:text-sm"
            href="#product"
          >
            See Chief at work <span>↓</span>
          </Link>
        </div>
      </div>

      <div className="relative mx-auto w-[min(1380px,92%)] pr-[88px] pb-[35px] max-lg:w-[93%] max-lg:pr-[65px] max-md:w-[95%] max-md:pr-[35px] max-md:pb-7">
        <Image
          alt="Chief desktop: Mission Control with the Engineer thread open"
          className="h-auto w-full drop-shadow-[0_24px_35px_#0003]"
          height={1094}
          priority
          src="/landing/mission-control.png"
          width={1838}
        />
        <div className="absolute right-0 bottom-0 w-[23.5%] max-md:w-[25%]">
          <div className="overflow-hidden rounded-[40px] border border-[#777] bg-[#141416] p-[7px] shadow-[0_20px_55px_#0005] max-md:rounded-[15px] max-md:p-[3px]">
            <Image
              alt="Chief for iPhone running the built-in demo workspace"
              className="h-auto w-full rounded-[33px] max-md:rounded-[11px]"
              height={2868}
              src="/landing/iphone.png"
              width={1320}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
