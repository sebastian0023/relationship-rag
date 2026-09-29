import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

export type GatitosScene = 'rest' | 'photos' | 'envelope' | 'empty' | 'sleep' | 'react';

interface Cat {
  readonly white: boolean;
  readonly transform: string;
  readonly closed: boolean;
  readonly delay: string;
  readonly fur: string;
  readonly inner: string;
}

interface Heart {
  readonly transform: string;
  readonly delay: string | null;
}

const cat = (white: boolean, x: number, flip: boolean, closed: boolean, delay: number): Cat => ({
  white,
  transform: flip ? `translate(${x + 120} 0) scale(-1 1)` : `translate(${x} 0)`,
  closed,
  delay: `${delay}s`,
  fur: white ? '#FFFEFB' : '#F2A35E',
  inner: white ? '#F6C6CB' : '#F9C9A0',
});

const SCENES: Readonly<Record<GatitosScene, { cats: readonly Cat[]; hearts: readonly Heart[] }>> = {
  rest: {
    cats: [cat(true, 6, false, true, 0), cat(false, 124, true, true, 2.5)],
    hearts: [{ transform: 'translate(119 6) scale(1)', delay: null }],
  },
  photos: { cats: [cat(true, 4, false, false, 0), cat(false, 126, true, false, 2)], hearts: [] },
  envelope: { cats: [cat(true, 4, false, false, 0), cat(false, 126, true, false, 2)], hearts: [] },
  empty: { cats: [cat(true, 4, false, false, 0), cat(false, 126, true, true, 2)], hearts: [] },
  sleep: { cats: [cat(true, 6, false, true, 0), cat(false, 124, true, true, 2)], hearts: [] },
  react: {
    cats: [cat(true, 6, false, true, 0), cat(false, 124, true, true, 1)],
    hearts: [
      { transform: 'translate(112 22) scale(1)', delay: '0s' },
      { transform: 'translate(126 10) scale(0.8)', delay: '0.9s' },
      { transform: 'translate(138 26) scale(0.7)', delay: '1.7s' },
    ],
  },
};

/**
 * The white kitten and the orange kitten. Always decorative: the information they accompany is also
 * written as text. Animation pauses while the tab is hidden or the drawing is off screen, and the
 * global reduced-motion rule makes it static.
 */
@Component({
  selector: 'nh-gatitos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'mx-auto block max-w-full leading-[0]',
    '[style.width]': 'width()',
  },
  template: `<svg
    viewBox="0 0 250 124"
    width="100%"
    focusable="false"
    [class.nh-gatitos-pausa]="paused()"
  >
    <ellipse cx="125" cy="116" rx="112" ry="5" fill="#382B36" opacity=".06" />
    @for (c of scene().cats; track $index) {
      <g [attr.transform]="c.transform">
        <g [class.nh-anim-cola]="animated()" [style.animation-delay]="c.delay">
          <path
            d="M84 98C108 98 114 74 101 62"
            fill="none"
            stroke="#382B36"
            stroke-width="11"
            stroke-linecap="round"
          />
          <path
            d="M84 98C108 98 114 74 101 62"
            fill="none"
            [attr.stroke]="c.fur"
            stroke-width="6.6"
            stroke-linecap="round"
          />
        </g>
        <path
          d="M32 104C28 82 40 66 60 66S92 82 88 104Z"
          [attr.fill]="c.fur"
          stroke="#382B36"
          stroke-width="2.2"
          stroke-linejoin="round"
        />
        @if (!c.white) {
          <path
            d="M37 88q6 2 9 -2M83 88q-6 2 -9 -2"
            stroke="#D07A34"
            stroke-width="2.4"
            fill="none"
            stroke-linecap="round"
          />
        }
        <g [class.nh-anim-oreja]="animated()" [style.animation-delay]="c.delay">
          <path
            d="M36 40L37 13L57 29Z"
            [attr.fill]="c.fur"
            stroke="#382B36"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <path d="M40 33L40.5 21L50 28.5Z" [attr.fill]="c.inner" />
        </g>
        <path
          d="M84 40L83 13L63 29Z"
          [attr.fill]="c.fur"
          stroke="#382B36"
          stroke-width="2.2"
          stroke-linejoin="round"
        />
        <path d="M80 33L79.5 21L70 28.5Z" [attr.fill]="c.inner" />
        <ellipse
          cx="60"
          cy="49"
          rx="29"
          ry="23.5"
          [attr.fill]="c.fur"
          stroke="#382B36"
          stroke-width="2.2"
        />
        @if (!c.white) {
          <path
            d="M53 27.5l1.6 6M60 26.5v7M67 27.5l-1.6 6"
            stroke="#D07A34"
            stroke-width="2.6"
            stroke-linecap="round"
          />
        }
        @if (c.closed) {
          <path
            d="M44 52q5 -5 10 0M66 52q5 -5 10 0"
            fill="none"
            stroke="#382B36"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        } @else {
          <ellipse cx="49" cy="51" rx="3.3" ry="4" fill="#382B36" />
          <ellipse cx="71" cy="51" rx="3.3" ry="4" fill="#382B36" />
          <circle cx="50.3" cy="49.4" r="1.2" fill="#fff" />
          <circle cx="72.3" cy="49.4" r="1.2" fill="#fff" />
        }
        <ellipse cx="42" cy="59" rx="5" ry="3" fill="#F2A7B0" opacity=".55" />
        <ellipse cx="78" cy="59" rx="5" ry="3" fill="#F2A7B0" opacity=".55" />
        <path
          d="M57.5 56.5h5l-2.5 3z"
          fill="#D9708A"
          stroke="#D9708A"
          stroke-width="1"
          stroke-linejoin="round"
        />
        <path
          d="M60 59.5q-1.5 3.5 -4.5 2.5M60 59.5q1.5 3.5 4.5 2.5"
          fill="none"
          stroke="#382B36"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          d="M33 55l-10 -2M33 59l-10 1.5M87 55l10 -2M87 59l10 1.5"
          stroke="#382B36"
          stroke-width="1.4"
          stroke-linecap="round"
          opacity=".5"
        />
        <ellipse
          cx="50"
          cy="104"
          rx="8"
          ry="4.5"
          [attr.fill]="c.fur"
          stroke="#382B36"
          stroke-width="2"
        />
        <ellipse
          cx="70"
          cy="104"
          rx="8"
          ry="4.5"
          [attr.fill]="c.fur"
          stroke="#382B36"
          stroke-width="2"
        />
        @if (c.white) {
          <g transform="translate(37 30) rotate(-20)">
            <path
              d="M0 0L-13 -8Q-16 0 -13 8Z"
              fill="#EE9AAB"
              stroke="#382B36"
              stroke-width="1.9"
              stroke-linejoin="round"
            />
            <path
              d="M0 0L13 -8Q16 0 13 8Z"
              fill="#EE9AAB"
              stroke="#382B36"
              stroke-width="1.9"
              stroke-linejoin="round"
            />
            <circle r="3.8" fill="#D9708A" stroke="#382B36" stroke-width="1.9" />
          </g>
        }
      </g>
    }
    @for (h of scene().hearts; track $index) {
      <g [attr.transform]="h.transform">
        <path
          d="M6 11S0 7.2 0 3.3C0 .4 3.6-.9 6 2.1 8.4-.9 12 .4 12 3.3 12 7.2 6 11 6 11z"
          fill="#E88FA0"
          [class.nh-anim-corazon]="animated() && h.delay !== null"
          [style.animation-delay]="h.delay"
        />
      </g>
    }
    @switch (name()) {
      @case ('photos') {
        <g transform="translate(99 72) rotate(-6)">
          <rect width="52" height="44" rx="3" fill="#FFFEFB" stroke="#382B36" stroke-width="2" />
          <rect x="5" y="5" width="42" height="28" fill="#DCE6D8" />
          <path
            d="M5 33l12 -12 9 8 7 -6 14 10"
            fill="none"
            stroke="#8FA88A"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <circle cx="37" cy="12" r="3.5" fill="#F4D7B5" />
        </g>
      }
      @case ('envelope') {
        <g transform="translate(94 76) rotate(4)">
          <rect width="62" height="40" rx="4" fill="#FFFEFB" stroke="#382B36" stroke-width="2" />
          <path
            d="M2 3l29 20 29 -20"
            fill="none"
            stroke="#382B36"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <circle cx="31" cy="24" r="5" fill="#8B3E55" />
        </g>
      }
      @case ('empty') {
        <g transform="translate(98 70) rotate(-4)">
          <rect width="54" height="46" rx="3" fill="#FFFEFB" stroke="#382B36" stroke-width="2" />
          <rect
            x="6"
            y="6"
            width="42"
            height="28"
            fill="none"
            stroke="#C9B8AA"
            stroke-width="1.6"
            stroke-dasharray="4 3"
          />
          <path d="M27 15v10M22 20h10" stroke="#C9B8AA" stroke-width="1.8" stroke-linecap="round" />
        </g>
      }
      @case ('sleep') {
        <text
          x="116"
          y="30"
          font-family="Newsreader Variable, Newsreader, serif"
          font-size="17"
          fill="#6B5A66"
        >
          z
        </text>
        <text
          x="128"
          y="16"
          font-family="Newsreader Variable, Newsreader, serif"
          font-size="12"
          fill="#6B5A66"
        >
          z
        </text>
      }
    }
  </svg>`,
})
export class GatitosComponent {
  public readonly name = input.required<GatitosScene>();
  public readonly width = input('210px');
  public readonly animated = input(true);

  protected readonly scene = computed(() => SCENES[this.name()]);
  private readonly hidden = signal(document.hidden);
  private readonly offscreen = signal(false);
  protected readonly paused = computed(() => this.hidden() || this.offscreen());

  public constructor() {
    const onVisibility = () => this.hidden.set(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) =>
            this.offscreen.set(entry?.isIntersecting === false),
          );
    observer?.observe(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    });
  }
}
