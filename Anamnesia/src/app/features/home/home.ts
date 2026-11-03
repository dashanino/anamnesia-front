import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';

import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import DailyIframe from '@daily-co/daily-js';

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

interface FeedbackTTS {
  texto: string;
  audio_base64: string;
  mime_type: string;
}

interface RespuestaEvaluacion {
  message: string;
  conversation_id: string;
  caso_id: string;
  escenario: string;
  evaluacion: ResultadoEvaluacion;
  feedback_tts?: FeedbackTTS;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy, OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly apiBase = 'http://127.0.0.1:3000/api/tavus/conversation';

  conversationId: string | null = null;
  conversationUrl: SafeResourceUrl | null = null;
  isLoadingLucy = false;
  isEndingLucy = false;
  isJoined = false;
  sessionStatus = 'Lista para iniciar';
  errorMessage = '';
  noticeMessage = '';

  isEvaluating = false;
  evaluation: ResultadoEvaluacion | null = null;
  evaluationError = '';

  private destroyed = false;
  private readonly cierresAlSalir = new Set<string>();
  private dailyCall: ReturnType<typeof DailyIframe.createFrame> | null = null;
  private pendingDailyUrl: string | null = null;
  private feedbackAudio: HTMLAudioElement | null = null;

  patient: Patient = {
    name: 'Lucy',
    age: 58,
    sex: 'Femenino',
    chiefComplaint: 'Dolor en el pecho',
  };

  messages: Message[] = [];
  userInput = '';
  currentCaption = '';
  isRecording = false;
  isProcessing = false;
  isPatientSpeaking = false;
  elapsedSeconds = 0;
  private timerInterval?: ReturnType<typeof setInterval>;

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    const conversationId = localStorage.getItem('anamnesia_ultima_conversacion');
    if (conversationId) {
      this.recuperarEvaluacion(conversationId);
    }
  }

  @ViewChild('dailyContainer')
  set dailyContainer(element: ElementRef<HTMLDivElement> | undefined) {
    if (element && this.pendingDailyUrl) {
      const url = this.pendingDailyUrl;
      this.pendingDailyUrl = null;
      this.iniciarDaily(url, element.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.solicitarCierreAlSalir();
    this.stopTimer();
    this.detenerFeedbackAudio();

    const call = this.dailyCall;
    this.dailyCall = null;
    if (call) {
      void call.destroy().catch((error) =>
        console.warn('Error al liberar Daily:', error),
      );
    }
  }

  @HostListener('window:pagehide')
  onPageHide(): void {
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
        if (!response.ok) {
          throw new Error(`Cierre no confirmado: HTTP ${response.status}`);
        }
      })
      .catch((error) => {
        this.cierresAlSalir.delete(id);
        console.warn('No se pudo confirmar el cierre al salir:', error);
      });
  }

  private refrescarVista(): void {
    if (!this.destroyed) this.cdr.markForCheck();
  }

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
  // ESCRITURA -> TAVUS
  // ==========================================================

  sendMessage(): void {
    const text = this.userInput.trim();

    if (!text || !this.conversationId || !this.dailyCall || !this.isJoined || this.isEndingLucy) {
      return;
    }

    const call = this.dailyCall;

    this.messages.push({
      id: Date.now(),
      sender: 'student',
      text,
      time: this.getCurrentTime(),
    });

    this.userInput = '';
    this.isProcessing = true;
    this.isPatientSpeaking = true;
    this.currentCaption = '';
    this.refrescarVista();

    try {
      call.sendAppMessage(
        {
          message_type: 'conversation',
          event_type: 'conversation.respond',
          conversation_id: this.conversationId,
          properties: {
            text,
          },
        },
        '*',
      );

      console.log('[Tavus] Pregunta escrita enviada:', text);
    } catch (error) {
      console.error('[Tavus] No se pudo enviar la pregunta escrita:', error);
      this.isProcessing = false;
      this.isPatientSpeaking = false;
      this.errorMessage = 'No se pudo enviar la pregunta a Lucy. Intenta nuevamente.';
      this.refrescarVista();
    }
  }

  toggleRecording(): void {
    if (!this.dailyCall || !this.isJoined) return;

    const newRecordingState = !this.isRecording;

    try {
      this.dailyCall.setLocalAudio(newRecordingState);
      this.isRecording = newRecordingState;
    } catch (error) {
      console.error('[Daily] No se pudo cambiar el micrófono:', error);
      this.isRecording = false;
      this.errorMessage = 'No se pudo cambiar el estado del micrófono.';
    }

    this.refrescarVista();
  }

  // ==========================================================
  // FINALIZAR Y EVALUAR
  // ==========================================================

  endConsultation(): void {
    if (!this.conversationId || this.isEndingLucy) return;
    if (!confirm('¿Quieres finalizar la anamnesis?')) return;

    const id = this.conversationId;
    this.isEndingLucy = true;
    this.sessionStatus = 'Finalizando...';
    this.errorMessage = '';
    this.noticeMessage = '';
    this.detenerFeedbackAudio();

    this.http
      .post<{ message?: string }>(
        `${this.apiBase}/${encodeURIComponent(id)}/finalizar`,
        {},
      )
      .subscribe({
        next: (response) => {
          const conversationIdParaEvaluar = id;
          localStorage.setItem('anamnesia_ultima_conversacion', conversationIdParaEvaluar);

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
              console.warn('La sesión terminó, pero Daily no se pudo liberar:', error);
            } finally {
              this.conversationUrl = null;
              this.isEndingLucy = false;
              this.refrescarVista();
              this.evaluarConversacion(conversationIdParaEvaluar);
            }
          })();
        },
        error: (error) => {
          console.error('No se pudo confirmar el cierre:', error);
          this.isEndingLucy = false;
          this.sessionStatus = 'Cierre pendiente';
          this.errorMessage = 'No se pudo confirmar el cierre. Pulsa Finalizar para reintentar.';
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
        {},
      )
      .subscribe({
        next: (response) => {
          this.evaluation = response.evaluacion;
          this.isEvaluating = false;
          this.sessionStatus = 'Evaluación completada';
          console.log('Resultado de evaluación:', response);

          if (response.feedback_tts?.audio_base64) {
            this.reproducirFeedbackTTS(response.feedback_tts);
          }

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

  private reproducirFeedbackTTS(feedback: FeedbackTTS): void {
    this.detenerFeedbackAudio();

    try {
      const audioUrl = `data:${feedback.mime_type};base64,${feedback.audio_base64}`;
      const audio = new Audio(audioUrl);
      this.feedbackAudio = audio;

      audio.onended = () => {
        if (this.feedbackAudio === audio) {
          this.feedbackAudio = null;
        }
      };

      audio.onerror = (error) => {
        console.error('[TTS] No se pudo reproducir el feedback:', error);
        if (this.feedbackAudio === audio) {
          this.feedbackAudio = null;
        }
      };

      void audio.play().catch((error) => {
        console.error('[TTS] El navegador bloqueó la reproducción automática:', error);
        this.feedbackAudio = null;
      });
    } catch (error) {
      console.error('[TTS] Error preparando el audio:', error);
    }
  }

  private detenerFeedbackAudio(): void {
    if (!this.feedbackAudio) return;

    this.feedbackAudio.pause();
    this.feedbackAudio.currentTime = 0;
    this.feedbackAudio = null;
  }

  recuperarEvaluacion(conversationId: string): void {
    this.isEvaluating = true;
    this.evaluationError = '';
    this.evaluation = null;
    this.sessionStatus = 'Recuperando evaluación...';

    this.http
      .get<RespuestaEvaluacion>(
        `${this.apiBase}/${encodeURIComponent(conversationId)}/evaluacion`,
      )
      .subscribe({
        next: (response) => {
          this.evaluation = response.evaluacion;
          this.isEvaluating = false;
          this.sessionStatus = 'Evaluación recuperada';
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

  private getCurrentTime(): string {
    return new Date().toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ==========================================================
  // CREAR CONVERSACIÓN TAVUS
  // ==========================================================

  iniciarSimulacion(): void {
    if (this.isLoadingLucy || this.isEndingLucy || this.conversationId) return;

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
    this.detenerFeedbackAudio();

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
          if (this.destroyed) {
            if (response.status !== 'ended') {
              this.solicitarCierreAlSalir(response.conversation_id);
            }
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
            this.pendingDailyUrl = url.toString();
            this.conversationUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
          } catch (error) {
            console.error('Error al preparar la URL:', error);
            this.errorMessage = 'No se pudo abrir la videollamada. Finaliza la sesión antes de reintentar.';
          } finally {
            this.isLoadingLucy = false;
            this.refrescarVista();
          }
        },
        error: (error) => {
          console.error('Error al iniciar Lucy:', error);
          this.sessionStatus = 'Error al iniciar';
          this.errorMessage =
            error.error?.message ||
            error.error?.error ||
            'No se pudo iniciar la conversación.';
          this.isLoadingLucy = false;
          this.refrescarVista();
        },
      });
  }

  // ==========================================================
  // DAILY / TAVUS
  // ==========================================================

  private iniciarDaily(url: string, container: HTMLDivElement): void {
    if (this.dailyCall) return;

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

      this.dailyCall.on('joined-meeting', () => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) return;

        this.isJoined = true;
        this.sessionStatus = 'En consulta';
        this.startTimer();
        this.refrescarVista();
      });

      this.dailyCall.on('app-message', (event: any) => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) return;

        try {
          const rawData = event.data;
          const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

          if (data?.event_type !== 'conversation.utterance') return;

          const properties = data?.properties;
          const role = properties?.role;
          const text = properties?.speech;

          if (role !== 'replica' || typeof text !== 'string' || !text.trim()) return;

          console.log('[Tavus] Lucy:', text);
          this.currentCaption = text;
          this.isPatientSpeaking = false;
          this.isProcessing = false;

          this.messages.push({
            id: Date.now() + Math.random(),
            sender: 'patient',
            text: text.trim(),
            time: this.getCurrentTime(),
          });

          this.refrescarVista();
        } catch (error) {
          console.error('[Tavus] Error procesando evento:', error);
          this.isProcessing = false;
          this.isPatientSpeaking = false;
          this.refrescarVista();
        }
      });

      this.dailyCall.on('left-meeting', () => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) return;

        this.isJoined = false;
        this.stopTimer();
        this.sessionStatus = 'Desconectada';
        this.errorMessage = 'Se perdió la conexión. Pulsa Finalizar para confirmar el cierre de la sesión.';
        this.refrescarVista();
      });

      this.dailyCall.on('error', (event) => {
        if (this.dailyCall !== call || !this.conversationId || this.isEndingLucy) return;

        console.error('[Daily] Error de conexión:', event);
        this.errorMessage = 'Error en la videollamada. Pulsa Finalizar para confirmar el cierre de la sesión.';
        this.refrescarVista();
      });

      this.dailyCall
        .join({ url })
        .then(() => console.log('Conexión con Daily establecida'))
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
