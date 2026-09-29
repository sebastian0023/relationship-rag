import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Envelope that opens and lifts its letter; under reduced motion it resolves instantly. */
@Component({
  selector: 'nh-sobre',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'relative mx-auto block h-[210px] w-[240px]' },
  template: `<div class="absolute inset-0 [perspective:700px]">
    <div
      class="absolute left-[18px] right-[18px] top-[92px] z-[2] h-[110px] rounded-md border-[1.5px] border-[#E2D3C6] bg-papel [animation:nhRise_.9s_.55s_ease-out_both] [background-image:repeating-linear-gradient(#FFFEFB_0_16px,#F1E7DC_16px_17px)]"
    ></div>
    <div
      class="absolute inset-x-0 bottom-0 z-[3] h-[130px] rounded-[10px] border-2 border-ciruela bg-durazno"
    ></div>
    <div
      class="absolute left-[2px] right-[2px] top-[82px] z-[4] h-[72px] origin-top bg-[#EDC39A] [animation:nhFlap_.6s_ease-in_both] [clip-path:polygon(0_0,100%_0,50%_100%)]"
    ></div>
    <div
      class="absolute left-[107px] top-[138px] z-[5] size-[26px] rounded-full bg-accion [animation:nhPop_.3s_reverse_both]"
    ></div>
  </div>`,
})
export class SobreComponent {}
