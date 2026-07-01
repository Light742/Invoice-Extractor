import React, { useState, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { 
  Upload, 
  FileText, 
  Loader2, 
  Copy, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  HelpCircle, 
  Share2, 
  ExternalLink, 
  LayoutDashboard, 
  FileSignature,
  ChevronRight,
  Printer
} from 'lucide-react';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface ExtractedData {
  id: string;
  fileName: string;
  companyName: string;
  invoiceNumber: string;
  invoiceReceivedDate: string;
  vatEx: string;
  poNumber: string;
  invoiceType: string;
  description: string;
  currency: string;
  isForeignService: boolean;
  hasMRIR: boolean;
  indicatesAdvancePayment: boolean;
  specialCase?: 'YES' | 'NO';
  advancePayment?: 'Yes' | 'No';
}

interface CocaData {
  companyName: string;
  serviceDescription: string;
  invoiceNumber: string;
  poNumber: string;
  amountInWords: string;
  currency: string;
  amount: number;
}

type View = 'extractor' | 'coca';
type QuestionType = 'FOREIGN_SERVICE' | 'ADVANCE_PAYMENT_GOODS' | 'ADVANCE_PAYMENT_SERVICES';

interface QueuedQuestion {
  id: string;
  documentId: string;
  fileName: string;
  type: QuestionType;
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('extractor');
  const [results, setResults] = useState<ExtractedData[]>([]);
  const [processingCount, setProcessingCount] = useState(0);
  const [interventionQueue, setInterventionQueue] = useState<QueuedQuestion[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [driveLink, setDriveLink] = useState<string | null>(null);

  // COCA States
  const [cocaFile, setCocaFile] = useState<File | null>(null);
  const [isProcessingCoca, setIsProcessingCoca] = useState(false);
  const [cocaResult, setCocaResult] = useState<CocaData | null>(null);
  const [cocaCopied, setCocaCopied] = useState(false);

  useEffect(() => {
    checkDriveStatus();
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsDriveConnected(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkDriveStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsDriveConnected(data.isAuthenticated);
    } catch (err) {
      console.error('Failed to check drive status:', err);
    }
  };

  const connectDrive = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      window.open(url, 'google_oauth', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get auth URL:', err);
      setErrors(prev => [...prev, 'Failed to connect to Google Drive.']);
    }
  };

  const uploadToDrive = async () => {
    if (results.length === 0) return;
    setIsUploading(true);
    setDriveLink(null);
    try {
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: results.map(r => ({
            'Company Name': r.companyName,
            'Invoice Number': r.invoiceNumber,
            'Invoice Received Date': r.invoiceReceivedDate,
            'Vat-Ex': r.vatEx,
            'PO Number': r.poNumber,
            'Invoice Type': r.invoiceType,
            'Description': r.description,
            'Currency': r.currency,
            'Special Case': r.specialCase || 'NO',
            'Advance Payment': r.advancePayment || 'No'
          })),
          fileName: `Malita_Invoices_${new Date().toISOString().split('T')[0]}.xlsx`
        })
      });
      
      if (!res.ok) throw new Error('Upload failed');
      
      const data = await res.json();
      setDriveLink(data.link);
    } catch (err) {
      console.error('Drive upload error:', err);
      setErrors(prev => [...prev, 'Failed to upload Excel to Google Drive.']);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFiles = (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(isValidFileType);
    
    if (validFiles.length !== files.length) {
      setErrors(prev => [...prev, 'Some files were skipped because they are not valid PDFs or images.']);
    }
    
    if (validFiles.length > 0) {
      setProcessingCount(prev => prev + validFiles.length);
      validFiles.forEach(processFile);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
  };

  const isValidFileType = (file: File) => {
    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    return validTypes.includes(file.type);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const processFile = async (fileToProcess: File) => {
    try {
      const base64Data = await fileToBase64(fileToProcess);
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: fileToProcess.type,
            }
          },
          {
            text: `Analyze the uploaded invoice document and purchase order (PO) page to extract specific data into a JSON structure.
            
EXTRACTION RULES & CONSTRAINTS:
1. Company Name: The supplier/contractor name. MUST NEVER be "Malita Power Inc.".
2. Invoice Number: The official Sales Invoice number (usually top right). Differentiate from Delivery Receipt. Output ONLY alphanumeric digits (e.g., "12345").
3. Invoice Received Date: Locate the handwritten date near the customer signature field. If (and ONLY if) a handwritten received date cannot be found, use the official issued date of the invoice as a fallback. Format strictly as MM/DD/YYYY.
4. Vat-Ex: Amount Net of VAT. Cannot be 0. If the invoice is from outside the Philippines, this value equals the gross amount.
5. PO Number: The Purchase Order number referenced on the invoice/PO page.
6. Invoice Type: Strictly categorize as "Goods", "Services", or null/empty if unclear.
7. Description: Cross-reference the attached PO page to extract the primary goods/services provided.
8. Currency: The currency used (PHP, USD, EUR, etc.).
9. Origin: Determine if the supplier company is located inside or outside the Philippines.
10. isForeignService: Set to true ONLY if Invoice Type is "Services" AND Origin is outside the Philippines. Otherwise false.
11. hasMRIR: Determine if there is a Material Requisition and Inspection Report (MRIR) included or referenced for goods. (true/false)
12. indicatesAdvancePayment: Determine if there are statements or indicators of an advance payment. (true/false)`
          }
        ],
        config: {
          systemInstruction: "You are an advanced OCR and data extraction system for Malita Power Inc.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companyName: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              invoiceReceivedDate: { type: Type.STRING },
              vatEx: { type: Type.STRING },
              poNumber: { type: Type.STRING },
              invoiceType: { type: Type.STRING },
              description: { type: Type.STRING },
              currency: { type: Type.STRING },
              isForeignService: { type: Type.BOOLEAN },
              hasMRIR: { type: Type.BOOLEAN },
              indicatesAdvancePayment: { type: Type.BOOLEAN }
            },
            required: ["companyName", "invoiceNumber", "invoiceReceivedDate", "vatEx", "poNumber", "invoiceType", "description", "currency", "isForeignService", "hasMRIR", "indicatesAdvancePayment"]
          }
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text) as ExtractedData;
        data.id = Date.now().toString(36) + Math.random().toString(36).substring(2);
        data.fileName = fileToProcess.name;
        data.specialCase = 'NO';
        data.advancePayment = 'No';
        
        setResults(prev => [...prev, data]);

        const newQuestions: QueuedQuestion[] = [];
        
        if (data.isForeignService) {
          newQuestions.push({
            id: Math.random().toString(36).substring(2),
            documentId: data.id,
            fileName: data.fileName,
            type: 'FOREIGN_SERVICE'
          });
        }

        if (data.invoiceType === 'Goods' && !data.hasMRIR) {
          newQuestions.push({
            id: Math.random().toString(36).substring(2),
            documentId: data.id,
            fileName: data.fileName,
            type: 'ADVANCE_PAYMENT_GOODS'
          });
        } else if (data.invoiceType === 'Services' && data.indicatesAdvancePayment) {
          newQuestions.push({
            id: Math.random().toString(36).substring(2),
            documentId: data.id,
            fileName: data.fileName,
            type: 'ADVANCE_PAYMENT_SERVICES'
          });
        }

        if (newQuestions.length > 0) {
          setInterventionQueue(prev => [...prev, ...newQuestions]);
        }
      } else {
        throw new Error('No data extracted from the document.');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      setErrors(prev => [...prev, `Error processing ${fileToProcess.name}: ${err instanceof Error ? err.message : 'Unknown error'}`]);
    } finally {
      setProcessingCount(prev => prev - 1);
    }
  };

  const handleModalResponse = (answer: boolean) => {
    const currentQuestion = interventionQueue[0];
    if (currentQuestion) {
      setResults(prev => prev.map(r => {
        if (r.id === currentQuestion.documentId) {
          if (currentQuestion.type === 'FOREIGN_SERVICE') {
            return { ...r, specialCase: answer ? 'YES' : 'NO' };
          } else if (currentQuestion.type === 'ADVANCE_PAYMENT_GOODS' || currentQuestion.type === 'ADVANCE_PAYMENT_SERVICES') {
            return { ...r, advancePayment: answer ? 'Yes' : 'No' };
          }
        }
        return r;
      }));
      setInterventionQueue(prev => prev.slice(1));
    }
  };

  const copyToClipboard = () => {
    if (results.length === 0) return;

    const headers = ['Company Name', 'Invoice Number', 'Invoice Received Date', 'Vat-Ex', 'PO Number', 'Invoice Type', 'Description', 'Currency', 'Special Case', 'Advance Payment'];
    const rows = results.map(r => [
      r.companyName,
      r.invoiceNumber,
      r.invoiceReceivedDate,
      r.vatEx,
      r.poNumber,
      r.invoiceType,
      r.description,
      r.currency,
      r.specialCase || 'NO',
      r.advancePayment || 'No'
    ].join('\t'));

    const tsvData = `${headers.join('\t')}\n${rows.join('\n')}`;
    
    navigator.clipboard.writeText(tsvData).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy: ', err);
      alert('Failed to copy to clipboard.');
    });
  };

  const removeError = (index: number) => {
    setErrors(prev => prev.filter((_, i) => i !== index));
  };
  
  const clearResults = () => {
    if (window.confirm('Are you sure you want to clear all results?')) {
      setResults([]);
      setDriveLink(null);
    }
  };

  const processCocaFile = async (file: File) => {
    setIsProcessingCoca(true);
    setCocaResult(null);
    try {
      const base64Data = await fileToBase64(file);
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            }
          },
          {
            text: `Analyze the uploaded invoice to extract data for a COCA (Certificate of Completion and Acceptance).
            
CRITICAL RULE:
If the invoice contains both Goods and Services, you MUST ONLY extract the costs and descriptions related to the SERVICES. The "amount" and "amountInWords" fields MUST reflect ONLY the service portion of the invoice. DO NOT include any costs or descriptions for Goods in the COCA.

EXTRACT THE FOLLOWING FIELDS:
1. companyName: The name of the service provider/supplier.
2. serviceDescription: A brief description of the SERVICES rendered as stated in the invoice or PO. Exclude any goods.
3. invoiceNumber: The Sales Invoice number.
4. poNumber: The Purchase Order number.
5. amountInWords: The total amount for SERVICES ONLY, written in words. It MUST include the full currency name and cents/centavos if applicable. 
   - Format for whole amounts: "[Amount in Words] [Currency Name] ONLY" (e.g., "FOUR HUNDRED BRITISH POUNDS ONLY").
   - Format for amounts with cents: "[Whole Amount in Words] [Currency Name] AND [Cents Amount in Words] [Cents/Centavos Name] ONLY" (e.g., "TWO HUNDRED PESOS AND FORTY-THREE CENTAVOS ONLY").
   - Always use UPPERCASE for the words.
6. currency: The currency code (e.g., "PHP", "USD").
7. amount: The total amount for SERVICES ONLY as a number with 2 decimal places.`
          }
        ],
        config: {
          systemInstruction: "You are an expert data extractor for certification documents.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              companyName: { type: Type.STRING },
              serviceDescription: { type: Type.STRING },
              invoiceNumber: { type: Type.STRING },
              poNumber: { type: Type.STRING },
              amountInWords: { type: Type.STRING },
              currency: { type: Type.STRING },
              amount: { type: Type.NUMBER }
            },
            required: ["companyName", "serviceDescription", "invoiceNumber", "poNumber", "amountInWords", "currency", "amount"]
          }
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text) as CocaData;
        setCocaResult(data);
      }
    } catch (err) {
      console.error('COCA processing error:', err);
      setErrors(prev => [...prev, `Failed to process COCA for ${file.name}`]);
    } finally {
      setIsProcessingCoca(false);
    }
  };

  const copyCocaToClipboard = () => {
    if (!cocaResult) return;
    
    const statement = `This is to certify that ${cocaResult.companyName} has rendered ${cocaResult.serviceDescription}

The above service is in accordance with Sales Invoice No. ${cocaResult.invoiceNumber} and PO No. ${cocaResult.poNumber} in the amount of ${cocaResult.amountInWords}. (${cocaResult.currency} ${cocaResult.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;

    navigator.clipboard.writeText(statement).then(() => {
      setCocaCopied(true);
      setTimeout(() => setCocaCopied(false), 2000);
    });
  };

  const renderExtractor = () => (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-center md:text-left space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Invoice Extractor
          </h1>
          <p className="text-slate-500 max-w-2xl">
            Automated OCR and data extraction for invoices and purchase orders.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {!isDriveConnected ? (
            <button 
              onClick={connectDrive}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Share2 className="w-4 h-4 text-slate-500" />
              Connect Google Drive
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              Google Drive Connected
            </div>
          )}
        </div>
      </header>

      {/* Upload Zone */}
      <div 
        className={`border-2 border-dashed border-slate-300 rounded-2xl text-center bg-white hover:bg-slate-50 transition-colors cursor-pointer group ${results.length > 0 ? 'p-6' : 'p-12'}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-upload')?.click()}
      >
        <input 
          type="file" 
          id="file-upload" 
          className="hidden" 
          accept=".pdf,.png,.jpg,.jpeg"
          multiple
          onChange={handleFileChange}
        />
        <div className={`flex flex-col items-center justify-center ${results.length > 0 ? 'space-y-2' : 'space-y-4'}`}>
          <div className={`bg-indigo-50 rounded-full group-hover:bg-indigo-100 transition-colors ${results.length > 0 ? 'p-3' : 'p-4'}`}>
            <Upload className={`${results.length > 0 ? 'w-6 h-6' : 'w-8 h-8'} text-indigo-600`} />
          </div>
          <div>
            <p className={`${results.length > 0 ? 'text-base' : 'text-lg'} font-medium text-slate-700`}>Click to upload or drag and drop</p>
            <p className="text-sm text-slate-500 mt-1">Upload multiple PDFs, PNGs, or JPGs</p>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((err, idx) => (
            <div key={idx} className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-start justify-between space-x-3">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <p>{err}</p>
              </div>
              <button onClick={() => removeError(idx)} className="text-red-500 hover:text-red-700">
                <X className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Loading State */}
      {processingCount > 0 && (
        <div className="flex items-center justify-center py-6 space-x-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
          <p className="text-slate-600 font-medium animate-pulse">
            Processing {processingCount} document{processingCount !== 1 ? 's' : ''}...
          </p>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Extraction Results ({results.length})
            </h2>
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={clearResults}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                Clear All
              </button>
              
              {isDriveConnected && (
                <button 
                  onClick={uploadToDrive}
                  disabled={isUploading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  {isUploading ? 'Uploading...' : 'Save to Google Drive'}
                </button>
              )}

              <button 
                onClick={copyToClipboard}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              >
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy to Excel'}
              </button>
            </div>
          </div>

          {driveLink && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <p className="font-medium">Excel file successfully uploaded to Google Drive!</p>
              </div>
              <a 
                href={driveLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold text-sm"
              >
                View File <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-6 py-4 font-medium">Company Name</th>
                    <th className="px-6 py-4 font-medium">Invoice Number</th>
                    <th className="px-6 py-4 font-medium">Received Date</th>
                    <th className="px-6 py-4 font-medium">Vat-Ex</th>
                    <th className="px-6 py-4 font-medium">PO Number</th>
                    <th className="px-6 py-4 font-medium">Type</th>
                    <th className="px-6 py-4 font-medium max-w-xs">Description</th>
                    <th className="px-6 py-4 font-medium">Currency</th>
                    <th className="px-6 py-4 font-medium">Special Case</th>
                    <th className="px-6 py-4 font-medium">Advance Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{row.companyName || '-'}</td>
                      <td className="px-6 py-4 font-mono text-slate-600">{row.invoiceNumber || '-'}</td>
                      <td className="px-6 py-4 text-slate-600">{row.invoiceReceivedDate || '-'}</td>
                      <td className="px-6 py-4 font-mono text-slate-900">{row.vatEx || '-'}</td>
                      <td className="px-6 py-4 font-mono text-slate-600">{row.poNumber || '-'}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {row.invoiceType || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={row.description}>
                        {row.description || '-'}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{row.currency || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          row.specialCase === 'YES' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {row.specialCase || 'NO'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          row.advancePayment === 'Yes' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {row.advancePayment || 'No'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderCocaCreator = () => (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
          COCA Creator
        </h1>
        <p className="text-slate-500 max-w-2xl">
          Generate Certificate of Completion and Acceptance statements from invoices.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div 
            className={`border-2 border-dashed border-slate-300 rounded-2xl text-center bg-white hover:bg-slate-50 transition-colors cursor-pointer p-12 group`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && file.type === 'application/pdf') {
                setCocaFile(file);
                processCocaFile(file);
              }
            }}
            onClick={() => document.getElementById('coca-upload')?.click()}
          >
            <input 
              type="file" 
              id="coca-upload" 
              className="hidden" 
              accept=".pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCocaFile(file);
                  processCocaFile(file);
                }
              }}
            />
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="bg-indigo-50 rounded-full group-hover:bg-indigo-100 transition-colors p-4">
                <Upload className="w-8 h-8 text-indigo-600" />
              </div>
              <div>
                <p className="text-lg font-medium text-slate-700">
                  {cocaFile ? cocaFile.name : 'Upload Invoice PDF'}
                </p>
                <p className="text-sm text-slate-500 mt-1">PDF files only for COCA generation</p>
              </div>
            </div>
          </div>

          {isProcessingCoca && (
            <div className="flex items-center justify-center py-6 space-x-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
              <p className="text-slate-600 font-medium animate-pulse">Analyzing document...</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {cocaResult ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <FileSignature className="w-5 h-5 text-indigo-600" />
                  Generated Statement
                </h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      window.print();
                    }}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Print Statement"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={copyCocaToClipboard}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    {cocaCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {cocaCopied ? 'Copied!' : 'Copy Statement'}
                  </button>
                </div>
              </div>
              <div className="p-8 space-y-6">
                <div className="prose prose-slate max-w-none">
                  <p className="text-lg leading-relaxed text-slate-800">
                    This is to certify that <span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.companyName}</span> has rendered <span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.serviceDescription}</span>
                  </p>
                  <p className="text-lg leading-relaxed text-slate-800">
                    The above service is in accordance with Sales Invoice No. <span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.invoiceNumber}</span> and PO No. <span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.poNumber}</span> in the amount of <span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.amountInWords}</span>. (<span className="font-bold border-b-2 border-indigo-100 px-1">{cocaResult.currency} {cocaResult.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>)
                  </p>
                </div>
              </div>
            </div>
          ) : !isProcessingCoca && (
            <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-white rounded-2xl border border-slate-200 border-dashed">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <FileSignature className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-medium text-slate-900">No Statement Generated</h3>
              <p className="text-slate-500 mt-2 max-w-xs mx-auto">
                Upload an invoice PDF on the left to generate the certification statement.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const currentQuestion = interventionQueue[0];

  const renderModalContent = () => {
    if (!currentQuestion) return null;

    let title = '';
    let description = '';
    let question = '';
    let Icon = AlertCircle;
    let iconColor = 'text-amber-600';
    let iconBg = 'bg-amber-100';

    if (currentQuestion.type === 'FOREIGN_SERVICE') {
      title = 'Foreign Service Detected';
      description = `The invoice "${currentQuestion.fileName}" appears to be for services from a supplier outside the Philippines.`;
      question = 'Was this service conducted within the Philippines?';
    } else if (currentQuestion.type === 'ADVANCE_PAYMENT_GOODS') {
      title = 'Missing MRIR';
      description = `The invoice "${currentQuestion.fileName}" is for Goods, but no Material Requisition and Inspection Report (MRIR) was found.`;
      question = 'Is this an advance payment?';
      Icon = HelpCircle;
      iconColor = 'text-blue-600';
      iconBg = 'bg-blue-100';
    } else if (currentQuestion.type === 'ADVANCE_PAYMENT_SERVICES') {
      title = 'Advance Payment Indicated';
      description = `The invoice "${currentQuestion.fileName}" is for Services and indicates an advance payment.`;
      question = 'Can you confirm this is an advance payment?';
      Icon = HelpCircle;
      iconColor = 'text-blue-600';
      iconBg = 'bg-blue-100';
    }

    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <div className={`w-12 h-12 ${iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
            <Icon className={`w-6 h-6 ${iconColor}`} />
          </div>
          <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
          <p className="text-slate-500">
            {description.split(`"${currentQuestion.fileName}"`).map((part, i, arr) => 
              i === arr.length - 1 ? part : <React.Fragment key={i}>{part}<span className="font-semibold text-slate-700">"{currentQuestion.fileName}"</span></React.Fragment>
            )}
          </p>
        </div>
        
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
          <p className="font-medium text-slate-800">{question}</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button 
            onClick={() => handleModalResponse(true)}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Yes
          </button>
          <button 
            onClick={() => handleModalResponse(false)}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
          >
            No
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed h-full z-30">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 leading-tight">Malita Power</h2>
              <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Invoice System</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setActiveView('extractor')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeView === 'extractor' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <LayoutDashboard className={`w-5 h-5 ${activeView === 'extractor' ? 'text-indigo-600' : 'group-hover:text-slate-900'}`} />
              <span className="font-medium">Invoice Extractor</span>
            </div>
            {activeView === 'extractor' && <ChevronRight className="w-4 h-4" />}
          </button>

          <button 
            onClick={() => setActiveView('coca')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeView === 'coca' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <FileSignature className={`w-5 h-5 ${activeView === 'coca' ? 'text-indigo-600' : 'group-hover:text-slate-900'}`} />
              <span className="font-medium">COCA Creator</span>
            </div>
            {activeView === 'coca' && <ChevronRight className="w-4 h-4" />}
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="p-4 bg-slate-50 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <HelpCircle className="w-3.5 h-3.5" />
              Need Help?
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Contact support for any issues with document processing.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 p-8 md:p-12">
        <div className="max-w-5xl mx-auto">
          {activeView === 'extractor' ? renderExtractor() : renderCocaCreator()}
        </div>
      </main>

      {/* Intervention Modal */}
      {currentQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            {renderModalContent()}
          </div>
        </div>
      )}
    </div>
  );
}
