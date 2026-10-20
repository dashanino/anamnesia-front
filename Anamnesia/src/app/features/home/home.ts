import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import DailyIframe from '@daily-co/daily-js';

// ==========================================================
// INTERFACES
// ==========================================================

interface Patient {
  name: string;
  age: number;
  sex: string;
  chiefComplaint: string;
}

interface Message {
  id: number;
  sender: 'student' | 'patient';
  text: string;
  time: string;
}

// ==========================================================
// COMPONENT
// ==========================================================

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit, OnDestroy {
  // ==========================================================
  // TAVUS
  // ==========================================================

  conversationId: string | null = null;
  conversationUrl: SafeResourceUrl | null = null;
  isLoadingLucy = false;

  private dailyCall: ReturnType<typeof DailyIframe.createFrame> | null = null;
  private pendingDailyUrl: string | null = null;

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
  ) {}

  // ==========================================================
  // DAILY CONTAINER
  // ==========================================================

  @ViewChild('dailyContainer')
  set dailyContainer(
    element: ElementRef<HTMLDivElement> | undefined
  ) {
    console.log('Contenedor Daily detectado:', !!element);
    console.log('URL pendiente:', this.pendingDailyUrl);

  if (element && this.pendingDailyUrl) {
    const url = this.pendingDailyUrl;

    this.pendingDailyUrl = null;

    console.log('Iniciando Daily...');
    this.iniciarDaily(url, element.nativeElement);
  }
}

  // ==========================================================
  // PATIENT
  // ==========================================================

  // Datos temporales de la interfaz.
  // Después se reemplazarán por datos del backend.

  patient: Patient = {
    name: 'Lucy',
    age: 58,
    sex: 'Femenino',
    chiefComplaint: 'Dolor en el pecho',
  };

  // ==========================================================
  // CONVERSATION
  // ==========================================================

  // El historial empieza vacío para no mostrar
  // respuestas ficticias antes de la entrevista.

  messages: Message[] = [];

  // ==========================================================
  // USER INPUT
  // ==========================================================

  userInput: string = '';

  // ==========================================================
  // CLOSED CAPTIONS
  // ==========================================================

  currentCaption: string = '';

  // ==========================================================
  // STATES
  // ==========================================================

  isRecording: boolean = false;
  isProcessing: boolean = false;
  isPatientSpeaking: boolean = false;

  // ==========================================================
  // TIMER
  // ==========================================================

  elapsedSeconds: number = 0;

  private timerInterval?: ReturnType<typeof setInterval>;

  // ==========================================================
  // LIFECYCLE
  // ==========================================================

  ngOnInit(): void {
    this.startTimer();
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    if (this.dailyCall) {
      void this.dailyCall.destroy();
      this.dailyCall = null;
    }
  }

  // ==========================================================
  // TIMER
  // ==========================================================

  private startTimer(): void {
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
    }, 1000);
  }

  get formattedTime(): string {
    const minutes = Math.floor(this.elapsedSeconds / 60);
    const seconds = this.elapsedSeconds % 60;

    return `${this.pad(minutes)}:${this.pad(seconds)}`;
  }

  private pad(value: number): string {
    return value.toString().padStart(2, '0');
  }

  // ==========================================================
  // SEND MESSAGE
  // ==========================================================

  sendMessage(): void {
    const text = this.userInput.trim();

    if (!text) {
      return;
    }

    this.messages.push({
      id: Date.now(),
      sender: 'student',
      text: text,
      time: this.getCurrentTime(),
    });

    this.userInput = '';

    // Pendiente: conectar el envío de texto a Tavus.
    // No generamos respuestas ficticias.
  }

  // ==========================================================
  // MICROPHONE
  // ==========================================================

  toggleRecording(): void {
    // El micrófono de Daily se controla dentro
    // de la videollamada.
    //
    // Este botón aún no controla el micrófono real.
    // Lo conectaremos cuando configuremos
    // los eventos y permisos de Daily.

    console.log('Control del micrófono pendiente de integración');
  }

  // ==========================================================
  // END CONSULTATION
  // ==========================================================

  endConsultation(): void {
    const confirmed = confirm('¿Quieres finalizar la anamnesis?');

    if (!confirmed) {
      return;
    }

    // Pendiente: llamar al endpoint de Flask
    // para finalizar la conversación en Tavus
    // y actualizar la simulación en PostgreSQL.

    console.log('Finalización pendiente de integración');
  }

  // ==========================================================
  // CURRENT TIME
  // ==========================================================

  private getCurrentTime(): string {
    return new Date().toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ==========================================================
  // CREATE TAVUS CONVERSATION
  // ==========================================================

  iniciarSimulacion(): void {
    if (this.isLoadingLucy || this.conversationId) {
      return;
    }

    this.isLoadingLucy = true;

    this.http
      .post<{
        conversation_id: string;
        conversation_url: string;
        message: string;
      }>('http://127.0.0.1:3000/api/tavus/conversation', {})
      .subscribe({
        next: (response) => {
          console.log('Respuesta de Tavus:', response);

          try {
            const url = new URL(response.conversation_url);

            if (url.protocol !== 'https:' || url.hostname !== 'tavus.daily.co') {
              throw new Error('URL de Tavus no permitida');
            }

            this.conversationId = response.conversation_id;

            // Guardamos la URL hasta que Angular
            // cree el contenedor de Daily.

            this.pendingDailyUrl = url.toString();

            // Esta asignación activa
            // @if (conversationUrl) en home.html.

            this.conversationUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
          } catch (error) {
            console.error('Error al preparar la URL:', error);
          } finally {
            this.isLoadingLucy = false;
          }
        },

        error: (error) => {
          console.error('Error al iniciar Lucy:', error);

          this.isLoadingLucy = false;
        },
      });
  }

  // ==========================================================
  // DAILY VIDEO CALL
  // ==========================================================

  private iniciarDaily(url: string, container: HTMLDivElement): void {
    if (this.dailyCall) {
      return;
    }

    try {
      this.dailyCall = DailyIframe.createFrame(container, {
        iframeStyle: {
          width: '100%',
          height: '100%',
          border: '0',
        },
        showLeaveButton: false,
      });

      this.dailyCall
        .join({ url })
        .then(() => {
          console.log('Conexión con Daily establecida');
        })
        .catch((error) => {
          console.error('Error al conectar Daily:', error);
        });
    } catch (error) {
      console.error('Error al crear Daily:', error);
    }
  }
}
