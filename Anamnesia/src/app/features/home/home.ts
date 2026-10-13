import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

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

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit, OnDestroy {

  // ==========================================================
  // PATIENT
  // ==========================================================

  patient: Patient = {
    name: 'María González',
    age: 58,
    sex: 'Femenino',
    chiefComplaint: 'Dolor en el pecho'
  };


  // ==========================================================
  // CONVERSATION
  // ==========================================================

  messages: Message[] = [
    {
      id: 1,
      sender: 'patient',
      text: 'Buenos días... desde esta mañana tengo un dolor en el pecho.',
      time: '10:21 AM'
    }
  ];


  // ==========================================================
  // USER INPUT
  // ==========================================================

  userInput: string = '';


  // ==========================================================
  // CLOSED CAPTIONS
  // ==========================================================

  currentCaption: string =
    'Buenos días... desde esta mañana tengo un dolor en el pecho.';


  // ==========================================================
  // STATES
  // ==========================================================

  // El estudiante está grabando
  isRecording: boolean = false;

  // La IA está procesando la pregunta
  isProcessing: boolean = false;

  // El paciente está hablando
  isPatientSpeaking: boolean = true;


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

    return value
      .toString()
      .padStart(2, '0');

  }


  // ==========================================================
  // SEND MESSAGE
  // ==========================================================

  sendMessage(): void {

    const text = this.userInput.trim();

    if (!text) {
      return;
    }


    // Agregar pregunta del estudiante

    this.messages.push({
      id: Date.now(),
      sender: 'student',
      text: text,
      time: this.getCurrentTime()
    });


    // Limpiar input

    this.userInput = '';


    // Por ahora simulamos la respuesta de la IA

    this.simulatePatientResponse();

  }


  // ==========================================================
  // SIMULATED PATIENT RESPONSE
  // ==========================================================

  private simulatePatientResponse(): void {

    this.isProcessing = true;
    this.isPatientSpeaking = false;


    setTimeout(() => {

      const response =
        'El dolor empezó hace aproximadamente dos horas, mientras estaba caminando.';


      this.messages.push({
        id: Date.now(),
        sender: 'patient',
        text: response,
        time: this.getCurrentTime()
      });


      // Closed captions

      this.currentCaption = response;


      // Actualizar estados

      this.isProcessing = false;
      this.isPatientSpeaking = true;

    }, 1800);

  }


  // ==========================================================
  // MICROPHONE
  // ==========================================================

  toggleRecording(): void {

    this.isRecording = !this.isRecording;


    if (this.isRecording) {

      console.log('🎙️ Recording started');

      /*
       * Aquí después conectaremos el STT.
       *
       * Ejemplo:
       *
       * microphone
       *      ↓
       * Speech-to-Text
       *      ↓
       * userInput
       *      ↓
       * sendMessage()
       */

    } else {

      console.log('⏹️ Recording stopped');

    }

  }


  // ==========================================================
  // END CONSULTATION
  // ==========================================================

  endConsultation(): void {

    const confirmed = confirm(
      '¿Quieres finalizar la anamnesis?'
    );


    if (!confirmed) {
      return;
    }


    console.log('Consultation finished');

    /*
     * Después aquí podemos:
     *
     * 1. Guardar la conversación
     * 2. Mandarla al backend
     * 3. Evaluar la anamnesis
     * 4. Calcular la puntuación
     * 5. Generar feedback
     */

  }


  // ==========================================================
  // CURRENT TIME
  // ==========================================================

  private getCurrentTime(): string {

    return new Date().toLocaleTimeString(
      'es-CO',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );

  }

}