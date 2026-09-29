import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AvisosComponent } from './ui/avisos.component.js';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AvisosComponent],
  template: `<router-outlet /><nh-avisos />`,
})
export class AppComponent {}
