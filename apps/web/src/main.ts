import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { loadRuntimeConfig, RUNTIME_CONFIG } from './app/auth/runtime-config';

void loadRuntimeConfig()
  .then((runtimeConfig) =>
    bootstrapApplication(AppComponent, {
      providers: [provideRouter(routes), { provide: RUNTIME_CONFIG, useValue: runtimeConfig }],
    }),
  )
  .catch((error: unknown) => console.error(error));
