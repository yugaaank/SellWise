import VoiceButton from './components/VoiceButton'
import './App.css'

function App() {
  return (
    <div className="app">
      <h1>CreditQ Sales Advisor</h1>
      <VoiceButton wsUrl="/ws" />
    </div>
  )
}

export default App
