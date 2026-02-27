import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;    
}

export default function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // todo: remove mock functionality - implement real password reset
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setIsLoading(false);
    setStatus('success');
    setMessage('Password reset link has been sent to your registered email address.');
  };

  const handleClose = () => {
    setEmail('');
    setEmployeeCode('');
    setStatus('idle');
    setMessage('');
    onClose();
  };
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-slate-900 border-blue-500/20 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-400" />
            Reset Password
          </DialogTitle>
          <DialogDescription className="text-blue-200/60">
            Enter your employee code and registered email to receive a password reset link.
          </DialogDescription>
        </DialogHeader>     
        
        {status === 'idle' ? (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reset-code" className="text-blue-100">Employee Code</Label>
              <Input
                id="reset-code"   
                placeholder="EMP001"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                className="bg-slate-800 border-blue-500/20 text-white"
                required
                data-testid="input-reset-code"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reset-email" className="text-blue-100">Email Address</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-slate-800 border-blue-500/20 text-white"
                required
                data-testid="input-reset-email"
              />
            </div>
            
            <DialogFooter className="pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleClose}
                className="border-slate-600"
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={isLoading}
                className="bg-gradient-to-r from-blue-600 to-cyan-600"
                data-testid="button-send-reset"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </Button>
            </DialogFooter>          
          </form>
        ) : status === 'success' ? (
          <div className="py-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <p className="text-white mb-2">Email Sent!</p>
            <p className="text-blue-200/60 text-sm mb-6">{message}</p>
            <Button onClick={handleClose} className="bg-green-600 hover:bg-green-500">
              Close
            </Button>
          </div>
        ) : (
          <div className="py-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <p className="text-white mb-2">Error</p>
            <p className="text-red-400/80 text-sm mb-6">{message}</p>
            <Button onClick={() => setStatus('idle')} variant="outline" className="border-slate-600">
              Try Again   
            </Button>
          </div>   
        )}
      </DialogContent>
    </Dialog>
  );
}
