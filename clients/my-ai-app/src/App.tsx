import { useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import ChatModule from './components/modules/ChatModule';
import MedicalModule from './components/modules/MedicalModule';
import LoraTrainingModule from './components/modules/LoraTrainingModule';
import RagModule from './components/modules/RagModule';
import ImageGenModule from './components/modules/ImageGenModule';

function App() {
  const [activeModule, setActiveModule] = useState('chat');

  const renderActiveModule = () => {
    switch (activeModule) {
      case 'chat':
        return <ChatModule />;
      case 'medical':
        return <MedicalModule />;
      case 'training':
        return <LoraTrainingModule />;
      case 'rag':
        return <RagModule />;
      case 'image':
        return <ImageGenModule />;
      default:
        return <ChatModule />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <div className="flex-1 overflow-auto">{renderActiveModule()}</div>
    </div>
  );
}

export default App;
