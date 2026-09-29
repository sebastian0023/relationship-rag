import type { CardStatus, MemoryDto } from '@relationship-rag/contracts';
import type { IconName } from './icons.js';

export type IngestionStatus = MemoryDto['ingestionStatus'];

export interface StatusStyle {
  readonly label: string;
  readonly icon: IconName;
  readonly background: string;
  readonly foreground: string;
}

export interface AiAvailability extends StatusStyle {
  readonly help: string;
  readonly canPrepare: boolean;
  readonly canRetry: boolean;
}

/** How a memory's indexing status reads to people: availability for conversation. */
export const AI_AVAILABILITY: Readonly<Record<IngestionStatus, AiAvailability>> = {
  NOT_REQUESTED: {
    label: 'Preparar para conversar',
    icon: 'sparkle',
    background: '#F3ECE4',
    foreground: '#5B4A57',
    help: 'Prepáralo para que la IA pueda consultar su texto en las conversaciones.',
    canPrepare: true,
    canRetry: false,
  },
  PENDING: {
    label: 'Preparando este recuerdo…',
    icon: 'hourglass',
    background: '#F7E9D6',
    foreground: '#6A4A1E',
    help: 'Puede tardar unos minutos. Puedes seguir usando la aplicación mientras tanto.',
    canPrepare: false,
    canRetry: false,
  },
  INDEXED: {
    label: 'Disponible para conversar',
    icon: 'check',
    background: '#E3ECE0',
    foreground: '#2F5236',
    help: 'La IA ya puede usar el texto de este recuerdo para responder.',
    canPrepare: false,
    canRetry: false,
  },
  FAILED: {
    label: 'No pudimos prepararlo',
    icon: 'alert',
    background: '#F8DAD6',
    foreground: '#8A2B25',
    help: 'Algo falló al prepararlo. Puedes intentarlo de nuevo.',
    canPrepare: false,
    canRetry: true,
  },
};

export const CARD_STATUS: Readonly<Record<CardStatus, StatusStyle>> = {
  DRAFT: { label: 'Borrador', icon: 'pencil', background: '#EEE8F5', foreground: '#4E3F66' },
  QUEUED: { label: 'En cola', icon: 'hourglass', background: '#F7E9D6', foreground: '#6A4A1E' },
  SCHEDULED: { label: 'Programada', icon: 'cal', background: '#E3ECE0', foreground: '#34543A' },
  SENT: { label: 'Enviada', icon: 'check', background: '#DCE6D8', foreground: '#2F5236' },
  DELIVERY_FAILED: {
    label: 'Error de entrega',
    icon: 'alert',
    background: '#F8DAD6',
    foreground: '#8A2B25',
  },
};

/** A card status that can still change on the server without user action. */
export const isCardInFlight = (status: CardStatus): boolean => status === 'QUEUED';
