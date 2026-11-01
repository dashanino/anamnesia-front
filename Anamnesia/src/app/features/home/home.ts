import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';

import { DecimalPipe } from '@angular/common';

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

interface CriterioEvaluacion {
  id: string;
  nombre: string;
  puntaje: number;
  puntaje_maximo: number;
  justificacion: string;
}

interface ResultadoEvaluacion {
  criterios: CriterioEvaluacion[];
  puntaje_total: number;
  puntaje_maximo: number;
  porcentaje: number;
  fortalezas: string[];
  aspectos_por_mejorar: string[];
  preguntas_omitidas: string[];
  retroalimentacion_general: string;
}

interface RespuestaEvaluacion {
  message: string;
  conversation_id: string;
  caso_id: string;
  escenario: string;
  evaluacion: ResultadoEvaluacion;
}

// ==========================================================
// COMPONENT
// ==========================================================

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy, OnInit {

  ngOnInit(): void {
  const conversationId = localStorage.getItem(
    'anamnesia_ultima_conversacion'
  );

  if (conversationId) {
    this.recuperarEvaluacion(conversationId);
  }
}
  private readonly cdr = inject(ChangeDetectorRef);

  // ==========================================================
  // TAVUS
  // ==========================================================

  conversationId: string | null = null;
  conversationUrl: SafeResourceUrl | null = null;
  isLoadingLucy = false;
  isEndingLucy = false;
  isJoined = false;
  sessionStatus = 'Lista para iniciar';
  errorMessage = '';
  noticeMessage = '';
  // ==========================================================
  // EVALUACIÓN
  // ==========================================================

  isEvaluating = false;
  evaluation: ResultadoEvaluacion | null = null;
  evaluationError = '';

  private destroyed = false;
  private readonly cierresAlSalir = new Set<string>();
  private readonly apiBase = 'http://127.0.0.1:3000/api/tavus/conversation';

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
  set dailyContainer(element: ElementRef<HTMLDivElement> | undefined) {
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

  ngOnDestroy(): void {
    this.destroyed = true;
    this.solicitarCierreAlSalir();
    this.stopTimer();
    const call = this.dailyCall;
    this.dailyCall = null;
    if (call) {
      void call.destroy().catch((error) => console.warn('Error al liberar Daily:', error));
    }
  }

  @HostListener('window:pagehide')
  onPageHide(): void {
    // Es un intento de cierre; una pérdida de red puede impedir su entrega.
    this.solicitarCierreAlSalir();
  }

  private solicitarCierreAlSalir(id: string | null = this.conversationId): void {
    if (!id || this.cierresAlSalir.has(id)) return;
    this.cierresAlSalir.add(id);
    void fetch(`${this.apiBase}/${encodeURIComponent(id)}/finalizar`, {
      method: 'POST',
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Cierre no confirmado: HTTP ${response.status}`);
      })
      .catch((error) => {
        this.cierresAlSalir.delete(id);
        console.warn('No se pudo confirmar el cierre al salir:', error);
      });
  }

  private refrescarVista(): void {
    if (!this.destroyed) this.cdr.markForCheck();
  }

  // ==========================================================
  // TIMER
  // ==========================================================

  private startTimer(): void {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.refrescarVista();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval !== undefined) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
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
    if (!this.conversationId || this.isEndingLucy) return;
    if (!confirm('¿Quieres finalizar la anamnesis?')) return;

    const id = this.conversationId;
    this.isEndingLucy = true;
    this.sessionStatus = 'Finalizando...';
    this.errorMessage = '';
    this.noticeMessage = '';

    this.http
      .post<{ message?: string }>(`${this.apiBase}/${encodeURIComponent(id)}/finalizar`, {})
      .subscribe({
        next: (response) => {
          // Conservamos el ID para solicitar la evaluación
          // después de confirmar el cierre de Tavus.
          const conversationIdParaEvaluar = id;
          localStorage.setItem(
            'anamnesia_ultima_conversacion',
            conversationIdParaEvaluar
          );
          // El backend respondió tras cerrar Tavus. Ahora libera la llamada local.
          this.conversationId = null;
          this.pendingDailyUrl = null;
          this.stopTimer();
          this.isJoined = false;
          this.isRecording = false;
          this.isProcessing = false;
          this.isPatientSpeaking = false;
          this.sessionStatus = 'Finalizada';
          this.noticeMessage = response.message || 'Conversación finalizada correctamente';
          const call = this.dailyCall;
          this.dailyCall = null;

          void (async () => {
            try {
              if (call) await call.destroy();
            } catch (error) {
              // El cierre remoto ya se confirmó aunque falle la limpieza local.
              console.warn('La sesión terminó, pero Daily no se pudo liberar:', error);
            } finally {
              this.conversationUrl = null;
              this.isEndingLucy = false;
              this.refrescarVista();

              // Una vez finalizada la conversación, solicitamos la evaluación.
              this.evaluarConversacion(conversationIdParaEvaluar);
            }
          })();
        },
        error: (error) => {
          console.error('No se pudo confirmar el cierre:', error);
          this.isEndingLucy = false;
          this.sessionStatus = 'Cierre pendiente';
          this.errorMessage = 'No se pudo confirmar el cierre. Pulsa Finalizar para reintentar.';
          // Mantiene el ID y la llamada para poder reintentar el cierre real.
          this.refrescarVista();
        },
      });
  }

  evaluarConversacion(conversationId: string): void {
  this.isEvaluating = true;
  this.evaluationError = '';
  this.evaluation = null;

  this.sessionStatus = 'Evaluando anamnesis...';

  this.http
    .post<RespuestaEvaluacion>(
      `${this.apiBase}/${encodeURIComponent(conversationId)}/evaluar`,
      {}
    )
    .subscribe({
      next: (response) => {
        this.evaluation = response.evaluacion;
        this.isEvaluating = false;
        this.sessionStatus = 'Evaluación completada';

        console.log('Resultado de evaluación:', response);

        this.refrescarVista();
      },

      error: (error) => {
        console.error('Error al evaluar la conversación:', error);

        this.isEvaluating = false;
        this.evaluationError =
          error.error?.message ||
          error.error?.error ||
          'No se pudo obtener la evaluación.';

        this.sessionStatus = 'Evaluación pendiente';

        this.refrescarVista();
      },
    });
}


  recuperarEvaluacion(conversationId: string): void {
    this.isEvaluating = true;
    this.evaluationError = '';
    this.evaluation = null;
    this.sessionStatus = 'Recuperando evaluación...';

    this.http
      .get<RespuestaEvaluacion>(
        `${this.apiBase}/${encodeURIComponent(conversationId)}/evaluacion`
      )
      .subscribe({
        next: (response) => {
          this.evaluation = response.evaluacion;
          this.isEvaluating = false;
          this.sessionStatus = 'Evaluación recuperada';
          console.log('Evaluación recuperada:', response);
          this.refrescarVista();
        },
        error: (error) => {
          console.error('Error al recuperar la evaluación:', error);
          this.isEvaluating = false;
          this.evaluationError =
            error.error?.message ||
            error.error?.error ||
            'No se pudo recuperar la evaluación guardada.';
          this.sessionStatus = 'Evaluación no disponible';
          this.refrescarVista();
        },
      });
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
    if (this.isLoadingLucy || this.isEndingLucy || this.conversationId) {
      return;
    }

    this.isLoadingLucy = true;
    this.sessionStatus = 'Preparando...';
    this.errorMessage = '';
    this.noticeMessage = '';
    this.elapsedSeconds = 0;
    this.evaluation = null;
    this.evaluationError = '';
    this.isEvaluating = false;
    this.messages = [];
    this.currentCaption = '';
    this.cierresAlSalir.clear();

    this.http
      .post<{
        conversation_id: string;
        conversation_url: string;
        message: string;
        status?: string;
        test_mode?: boolean;
      }>(this.apiBase, {})
      .subscribe({
        next: (response) => {
          console.log('Respuesta de Tavus:', response);
          if (this.destroyed) {
            // Si el usuario salió mientras se creaba, cierra el ID recién recibido.
            if (response.status !== 'ended') this.solicitarCierreAlSalir(response.conversation_id);
            return;
          }

          try {
            if (response.status === 'ended' || response.test_mode === true) {
              this.sessionStatus = 'Sin sesión activa';
              this.noticeMessage = 'La conversación se creó finalizada. No hay una sesión activa.';
              return;
            }
            this.conversationId = response.conversation_id;
            const url = new URL(response.conversation_url);

            if (url.protocol !== 'https:' || url.hostname !== 'tavus.daily.co') {
              throw new Error('URL de Tavus no permitida');
            }

            this.sessionStatus = 'Esperando ingreso';

            // Guardamos la URL hasta que Angular
            // cree el contenedor de Daily.

            this.pendingDailyUrl = url.toString();

            // Esta asignación activa
            // @if (conversationUrl) en home.html.

            this.conversationUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
          } catch (error) {
            console.error('Error al preparar la URL:', error);
            this.errorMessage =
              'No se pudo abrir la videollamada. Finaliza la sesión antes de reintentar.';
          } finally {
            this.isLoadingLucy = false;
            // Angular sin ZoneJS necesita una notificación tras el HTTP.
            // Esto renderiza el @if y activa el ViewChild sin otro clic.
            this.refrescarVista();
          }
        },

        error: (error) => {
          console.error('Error al iniciar Lucy:', error);
          this.sessionStatus = 'Error al iniciar';
          this.errorMessage =
            error.error?.message || error.error?.error || 'No se pudo iniciar la conversación.';

          this.isLoadingLucy = false;
          this.refrescarVista();
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

      const call = this.dailyCall;

      // Cuando el estudiante se conecta
      this.dailyCall.on('joined-meeting', () => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) {
          return;
        }

        this.isJoined = true;
        this.sessionStatus = 'En consulta';
        this.startTimer();
        this.refrescarVista();

        console.info('[Daily] Participante local conectado', new Date().toISOString());
      });

      // SUBTÍTULOS EN TIEMPO REAL
      this.dailyCall.on('app-message', (event: any) => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) {
          return;
        }

        try {
          const rawData = event.data;

          const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

          console.log('[Tavus] Evento recibido:', data);

          const properties = data?.properties;

          // Solo queremos eventos de conversación
          if (data?.event_type !== 'conversation.utterance') {
            return;
          }

          // Solo Lucy
          if (properties?.role !== 'replica') {
            return;
          }

          // El texto viene en "speech"
          const text = properties?.speech;

          if (typeof text !== 'string' || !text.trim()) {
            return;
          }

          console.log('[Tavus] Texto de Lucy:', text);

          // Mostrarlo en NUESTROS subtítulos
          this.currentCaption = text;
          this.isPatientSpeaking = false;

          this.refrescarVista();
        } catch (error) {
          console.error('[Tavus] Error procesando subtítulos:', error);
        }
      });

      // Cuando se desconecta
      this.dailyCall.on('left-meeting', () => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) {
          return;
        }

        this.isJoined = false;
        this.stopTimer();
        this.sessionStatus = 'Desconectada';

        this.errorMessage =
          'Se perdió la conexión. Pulsa Finalizar para confirmar el cierre de la sesión.';

        this.refrescarVista();

        console.warn('[Daily] Participante local desconectado', new Date().toISOString());
      });

      // Error de Daily
      this.dailyCall.on('error', (event) => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) {
          return;
        }

        console.error('[Daily] Error de conexión:', event);

        this.errorMessage =
          'Error en la videollamada. Pulsa Finalizar para confirmar el cierre de la sesión.';

        this.refrescarVista();
      });

      this.dailyCall
        .join({ url })
        .then(() => {
          console.log('Conexión con Daily establecida');
        })
        .catch((error) => {
          console.error('Error al conectar Daily:', error);
          this.refrescarVista();
        });
    } catch (error) {
      console.error('Error al crear Daily:', error);
      this.refrescarVista();
    }
  }
}
