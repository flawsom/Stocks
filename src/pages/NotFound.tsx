import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Zap, ArrowRight, Radio } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-terminal-bg text-slate-200 flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/3 w-[500px] h-[500px] rounded-full bg-brand-cyan/5 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-neural/5 blur-[120px]" />
      </div>

      <div className="relative text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded bg-brand-cyan/10 border border-brand-cyan/30 flex items-center justify-center">
            <Zap size={16} className="text-brand-cyan" />
          </div>
          <span className="text-sm font-mono font-bold text-brand-cyan text-glow-cyan">Ω OmegaTrade Ultra</span>
        </div>

        <div className="font-mono text-6xl md:text-7xl font-bold text-brand-cyan text-glow-cyan tracking-tight mb-3">
          404
        </div>
        <div className="text-lg font-mono font-semibold text-slate-300 mb-2">
          SIGNAL LOST — ROUTE NOT FOUND
        </div>
        <p className="text-sm font-mono text-slate-500 mb-2">
          No live feed exists for <span className="text-brand-cyan/80">{location.pathname}</span>
        </p>
        <p className="text-xs font-mono text-slate-600 mb-8">
          The terminal is still streaming — head back to the action.
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link
            to="/terminal"
            className="flex items-center gap-2 px-6 py-3 rounded text-sm font-mono font-bold bg-brand-cyan text-terminal-bg hover:bg-brand-cyanDim transition-colors shadow-cyan-glow"
          >
            <Radio size={14} /> LAUNCH TERMINAL
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 px-6 py-3 rounded text-sm font-mono font-semibold border border-terminal-border text-slate-400 hover:text-slate-200 hover:border-terminal-borderLight transition-colors"
          >
            RETURN HOME <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
